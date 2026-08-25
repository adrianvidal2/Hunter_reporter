import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatCompletion, LlmApiError } from './client'

const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], model: 'test-model' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const opts = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model',
  messages: [{ role: 'user' as const, content: 'ping' }],
}

describe('chatCompletion (cliente OpenAI-compatible)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('200 → devuelve contenido, finishReason y modelo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok('pong'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await chatCompletion({ ...opts, maxTokens: 5 }, fetchMock as unknown as typeof fetch)
    expect(res).toEqual({ content: 'pong', finishReason: 'stop', model: 'test-model', usage: undefined })

    // forma de la petición
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(init.headers).toMatchObject({ authorization: 'Bearer sk-test' })
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'test-model', stream: false })
  })

  it('401 → LlmApiError kind=auth; 429 → rate_limit; 500 → server', async () => {
    for (const [status, kind] of [[401, 'auth'], [403, 'auth'], [429, 'rate_limit'], [500, 'server']] as const) {
      const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"x"}', { status }))
      vi.stubGlobal('fetch', fetchMock)
      await expect(
        chatCompletion(opts, fetchMock as unknown as typeof fetch),
      ).rejects.toMatchObject({ kind })
    }
  })

  it('timeout (AbortError) → kind=timeout; JSON malformado → bad_json; vacío → empty', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const slow = vi.fn().mockImplementation((_url, init: RequestInit) =>
      new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(abortErr))),
    )
    vi.stubGlobal('fetch', slow)
    await expect(chatCompletion({ ...opts, timeoutMs: 30 }, slow as unknown as typeof fetch)).rejects.toMatchObject({
      kind: 'timeout',
    })

    const badJson = vi.fn().mockResolvedValue(new Response('esto no es json', { status: 200 }))
    vi.stubGlobal('fetch', badJson)
    await expect(chatCompletion(opts, badJson as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'bad_json' })

    const empty = vi.fn().mockResolvedValue(ok('   '))
    vi.stubGlobal('fetch', empty)
    await expect(chatCompletion(opts, empty as unknown as typeof fetch)).rejects.toMatchObject({ kind: 'empty' })
  })

  it('valida entradas antes de llamar (sin fetch)', async () => {
    for (const bad of [
      { baseUrl: '', apiKey: 'k', model: 'm' },
      { baseUrl: 'https://x/v1', apiKey: '', model: 'm' },
      { baseUrl: 'https://x/v1', apiKey: 'k', model: '' },
    ]) {
      await expect(chatCompletion(bad as never, vi.fn())).rejects.toBeInstanceOf(LlmApiError)
    }
  })
})
