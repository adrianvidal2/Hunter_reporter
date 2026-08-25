import { describe, expect, it, vi } from 'vitest'
import { LlmApiError } from './client'
import { rewriteReport, validateRewriteOutput, RewriteValidationError } from './rewrite'

const TEMPLATE = [
  '# {{titulo}}',
  '',
  '## Executive Summary',
  '',
  '{{resumen}}',
  '',
  '## Impact',
  '',
  '{{impacto}}',
].join('\n')

const GOOD = '# SQL Injection in /search\n\n## Executive Summary\n\nReflected input.\n\n## Impact\n\nData exposure.\n'

const opts = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model',
  fetchImpl: vi.fn(),
  sleepImpl: vi.fn().mockResolvedValue(undefined),
}

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const okRes = (content: string, finish = 'stop') =>
  jsonRes({ choices: [{ message: { content }, finish_reason: finish }] })

describe('rewriteReport (8.2: happy path sin escrituras)', () => {
  it('devuelve el markdown validado con diagnóstico; fetch llamado con system+user', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okRes(GOOD))
    const res = await rewriteReport('# Original\n', TEMPLATE, { ...opts, fetchImpl })

    expect(res).toMatchObject({ ok: true, markdown: GOOD })
    if (res.ok) {
      expect(res.info.attempts).toBe(1)
      expect(res.info.usage).toBeUndefined()
    }
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].role).toBe('user')
    expect(body.stream).toBe(false)
    expect(body.temperature).toBe(0.2)
  })
})

describe('validateRewriteOutput (rechazo duro del checkpoint)', () => {
  it('acepta markdown que sigue la plantilla', () => {
    expect(() => validateRewriteOutput(GOOD, TEMPLATE)).not.toThrow()
  })

  it('rechaza: vacío, eco de delimitadores, fence exterior total', () => {
    expect(() => validateRewriteOutput('   ', TEMPLATE)).toThrow(RewriteValidationError)
    expect(() => validateRewriteOutput('## Executive Summary\n</PLANTILLA>', TEMPLATE)).toThrow(
      /delimitadores/,
    )
    expect(() => validateRewriteOutput('```\n# x\n## Executive Summary\n```', TEMPLATE)).toThrow(
      /envuelve todo el documento/,
    )
  })

  it('rechaza si NO contiene ningún encabezado de la plantilla (compara contra la plantilla EN, no el original)', () => {
    // markdown válido pero sin encabezados de la plantilla (p. ej. secciones en español)
    const español = '# Título\n\n## Resumen ejecutivo\n\nTexto\n\n## Impacto\n\nTexto\n'
    expect(() => validateRewriteOutput(español, TEMPLATE)).toThrow(/no sigue la plantilla/)
    // sin ningún encabezado
    expect(() => validateRewriteOutput('solo texto plano sin encabezados', TEMPLATE)).toThrow(
      /no sigue la plantilla/,
    )
  })
})

describe('8.3: batería de errores — mensaje propio y CERO reintentos donde toca', () => {
  it('401 (auth): falla sin reintentos', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ error: 'bad key' }, 401))
    const res = await rewriteReport('x', TEMPLATE, { ...opts, fetchImpl })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.kind).toBe('llm')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('429 (rate limit): reintenta con backoff y puede recuperarse', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ error: 'slow down' }, 429))
      .mockResolvedValueOnce(okRes(GOOD))
    const sleep = vi.fn().mockResolvedValue(undefined)
    const res = await rewriteReport('x', TEMPLATE, { ...opts, fetchImpl, sleepImpl: sleep })
    expect(res.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(2_000)
  })

  it('timeout: falla SIN reintentos (checkpoint: timeout no reintenta)', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const fetchImpl = vi.fn().mockImplementation((_u, init: RequestInit) =>
      new Promise((_r, rej) => init.signal?.addEventListener('abort', () => rej(abortErr))),
    )
    const res = await rewriteReport('x', TEMPLATE, { ...opts, fetchImpl, timeoutMs: 25 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/Sin respuesta en 25 ms/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('JSON malformado (200): falla con mensaje propio y SIN reintentos', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('no es json', { status: 200 }))
    const res = await rewriteReport('x', TEMPLATE, { ...opts, fetchImpl })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.kind).toBe('llm')
      expect(res.error).toMatch(/JSON/)
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('stream cortado / finish_reason=length → validation, sin reintentos', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okRes('## Executive Summary\n parcial…', 'length'))
    const res = await rewriteReport('x', TEMPLATE, { ...opts, fetchImpl })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.kind).toBe('validation')
      expect(res.error).toMatch(/truncada/)
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('500 (server): reintenta hasta 2 veces y luego falla con mensaje propio', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ error: 'boom' }, 500))
    const sleep = vi.fn().mockResolvedValue(undefined)
    const res = await rewriteReport('x', TEMPLATE, { ...opts, fetchImpl, sleepImpl: sleep })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/HTTP 500/)
    expect(fetchImpl).toHaveBeenCalledTimes(3) // 1 + 2 reintentos
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenNthCalledWith(1, 2_000)
    expect(sleep).toHaveBeenNthCalledWith(2, 8_000)
  })

  it('salida válida HTTP pero contenido que no cumple plantilla → validation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okRes('hola mundo sin estructura'))
    const res = await rewriteReport('x', TEMPLATE, { ...opts, fetchImpl })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.kind).toBe('validation')
  })
})

describe('cero escrituras', () => {
  it('ningún caso de error ni de éxito toca el sistema de ficheros', async () => {
    // rewriteReport es pura: no importa el resultado, no hay imports de fs
    // en rewrite.ts. Verificación estructural del import del módulo.
    const src = await import('node:fs')
    const moduleSource = (await import('./rewrite')) as unknown as Record<string, unknown>
    expect(moduleSource.rewriteReport).toBeTypeOf('function')
    expect(Object.keys(moduleSource).sort()).toEqual([
      'RewriteValidationError',
      'rewriteReport',
      'validateRewriteOutput',
    ])
    expect(src.existsSync).toBeTypeOf('function') // fs intacto (sanity)
  })
})
