import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { YwhApiError, YwhClient } from './client'
import { assertTokenValid } from './token'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.resolve(here, '../../../docs/fixtures/ywh')
const pageFixture = JSON.parse(readFileSync(path.join(fixtures, 'programs-page1.json'), 'utf8'))
const detailFixture = JSON.parse(readFileSync(path.join(fixtures, 'program-detail.json'), 'utf8'))

const sleep = vi.fn().mockResolvedValue(undefined)
const now = vi.fn(() => NOW)
let NOW = 1_000_000

const makeClient = (fetchImpl: typeof fetch, token: { jwt: string; source: 'env' } | null = null) =>
  new YwhClient(token, { fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: sleep, nowMs: now, timeoutMs: 5_000 })

/** JWT de mentira vigente (exp en el futuro respecto de NOW). */
const VALID_JWT = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(`{"exp":${(NOW + 3_600_000) / 1000}}`).toString('base64url')}.sig`

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const noToken = null as never

describe('YwhClient · páginas', () => {
  it('UNA página: lista completa sin más llamadas', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ ...pageFixture, pagination: { page: 1, nb_pages: 1, results_per_page: 42, nb_results: 3 } }))
    const { items, stats } = await makeClient(fetchImpl).fetchAllPrograms()
    expect(items).toHaveLength(3)
    expect(stats.pages).toBe(1)
    expect(stats.privateItems).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled() // 1 página → sin pacing
  })

  it('CINCO páginas: itera hasta nb_pages con pacing entre páginas', async () => {
    const page = (n: number) => ({ ...pageFixture, pagination: { page: n, nb_pages: 5, results_per_page: 42, nb_results: 207 } })
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(page(1)))
      .mockResolvedValueOnce(jsonRes(page(2)))
      .mockResolvedValueOnce(jsonRes(page(3)))
      .mockResolvedValueOnce(jsonRes(page(4)))
      .mockResolvedValueOnce(jsonRes(page(5)))
    const pages: string[] = []
    const { items, stats } = await makeClient(fetchImpl).fetchAllPrograms((p, of) => pages.push(`${p}/${of}`))
    expect(fetchImpl).toHaveBeenCalledTimes(5)
    expect(stats.pages).toBe(5)
    expect(items).toHaveLength(15) // 3 por página
    expect(pages.at(-1)).toBe('5/5')
    expect(sleep).toHaveBeenCalledTimes(4) // pacing solo ENTRE páginas
  })
})

describe('YwhClient · errores', () => {
  it('401 → kind=auth con mensaje que apunta a Ajustes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ code: 401, message: 'Invalid JWT Token' }, 401))
    await expect(makeClient(fetchImpl, { jwt: VALID_JWT, source: 'env' }).listProgramsPage()).rejects.toMatchObject({
      kind: 'auth',
      status: 401,
    })
  })

  it('500 → kind=server; 404 → kind=not_found en detalle', async () => {
    const e500 = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }))
    await expect(makeClient(e500).listProgramsPage()).rejects.toMatchObject({ kind: 'server', status: 500 })

    const e404 = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }))
    await expect(makeClient(e404).getProgram('slug-inexistente')).rejects.toMatchObject({ kind: 'not_found' })
  })

  it('timeout (AbortError) → kind=timeout; JSON malformado → bad_json; forma rota → validation', async () => {
    // fetch que NUNCA responde: el AbortController del cliente dispara y el
    // mock rechaza con AbortError al capturar el abort
    const slow = vi.fn().mockImplementation((_u, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        )
      }),
    )
    await expect(
      new YwhClient(null, { fetchImpl: slow as unknown as typeof fetch, sleepImpl: sleep, nowMs: now, timeoutMs: 50 }).listProgramsPage(),
    ).rejects.toMatchObject({ kind: 'timeout' })

    const badJson = vi.fn().mockResolvedValue(new Response('no json', { status: 200 }))
    await expect(makeClient(badJson).listProgramsPage()).rejects.toMatchObject({ kind: 'bad_json' })

    const roto = vi.fn().mockResolvedValue(jsonRes({ sin: 'items' }))
    await expect(makeClient(roto).listProgramsPage()).rejects.toMatchObject({ kind: 'validation' })
  })

  it('9.3 integrado: token caducado → error ANTES de cualquier fetch', async () => {
    const expiredJwt = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(`{"exp":${(NOW - 60_000) / 1000}}`).toString('base64url')}.sig`
    const fetchImpl = vi.fn()
    await expect(makeClient(fetchImpl, { jwt: expiredJwt, source: 'env' }).listProgramsPage()).rejects.toMatchObject({
      name: 'TokenExpiredError',
    })
    expect(fetchImpl).not.toHaveBeenCalled() // no se gastó la llamada
  })

  it('sin token: no va Authorization (modo solo-públicos)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(pageFixture))
    await makeClient(fetchImpl, noToken).listProgramsPage()
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toEqual({})
  })

  it('con token: Authorization Bearer presente en la petición', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(pageFixture))
    await makeClient(fetchImpl, { jwt: VALID_JWT, source: 'env' }).listProgramsPage()
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.yeswehack.com/programs?page=1')
    expect(init.headers).toMatchObject({ authorization: `Bearer ${VALID_JWT}` })
  })
})

describe('YwhClient · detalle', () => {
  it('getProgram devuelve el Program parseado (fixture completo, 74 campos)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(detailFixture))
    const p = await makeClient(fetchImpl, { jwt: VALID_JWT, source: 'env' }).getProgram('anonymized-program-1')
    expect(p.slug).toBe('anonymized-program-1')
    expect(p.scopes).toHaveLength(1)
    expect(fetchImpl.mock.calls[0]![0]).toContain('/programs/anonymized-program-1')
  })
})

describe('YwhClient · mis reportes (user/reports)', () => {
  const item = (id: number) => ({
    id, local_id: `YWH-${id}`, title: `Reporte ${id}`, scope: '',
    program: { title: 'P', slug: 'p', public: false, bounty: true },
    status: { workflow_state: 'under_review' },
    cvss: { criticity: 'C', score: 10, vector: '', version: 'v3.1' },
    hunter: { username: 'h' }, reward: 100, cost_credits: null, currency: 'EUR',
    marked_as: 'R', collaborative: false,
    created_at: '2026-08-20T17:44:34+02:00', changed_at: '2026-08-20T17:49:07+02:00',
    ask_for_fix_verification_status: 'UNKNOWN',
  })

  it('recorre >1 página hasta nb_pages con pacing', async () => {
    const page = (n: number) => ({
      items: [item(n), item(n + 10)],
      pagination: { page: n, nb_pages: 3, results_per_page: 50, nb_results: 6 },
    })
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      const m = /user\/reports\?page=(\d+)/.exec(String(url))
      const n = m ? Number(m[1]) : 1
      return Promise.resolve(jsonRes(page(n)))
    })
    const { items, stats } = await makeClient(fetchImpl, { jwt: VALID_JWT, source: 'env' }).fetchAllMyReports()
    expect(items).toHaveLength(6)
    expect(stats.pages).toBe(3)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalled() // pacing entre páginas
  })

  it('sin token lanza error de auth', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ items: [], pagination: { page: 1, nb_pages: 1, results_per_page: 50, nb_results: 0 } }))
    await expect(makeClient(fetchImpl, null).fetchAllMyReports()).rejects.toMatchObject({ kind: 'auth' })
  })
})

// sanity del helper de token usado en los tests
describe('assertTokenValid (recheck local)', () => {
  it('el JWT vigente de los tests pasa', () => {
    expect(() => assertTokenValid(VALID_JWT, NOW)).not.toThrow()
  })
})
