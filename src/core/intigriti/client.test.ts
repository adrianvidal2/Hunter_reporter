import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { IntigritiApiError, IntigritiClient, type IntigritiClientOptions } from './client'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.resolve(here, '../../../docs/fixtures/intigriti')
const pageFixture = JSON.parse(readFileSync(path.join(fixtures, 'programs-page1.json'), 'utf8'))
const detailFixture = JSON.parse(readFileSync(path.join(fixtures, 'program-detail.json'), 'utf8'))

const sleep = vi.fn().mockResolvedValue(undefined)
const PAT = 'pat-de-mentira-66-chars'

const makeClient = (fetchImpl: typeof fetch, opts: IntigritiClientOptions = {}) =>
  new IntigritiClient(PAT, { fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: sleep, nowMs: () => 1_000_000, timeoutMs: 5_000, ...opts })

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('IntigritiClient · paginación por offset', () => {
  it('UNA página: maxCount alcanzado con la primera tanda, sin pacing', async () => {
    // fixture: maxCount 2, records 2 → no hay segunda página
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(pageFixture))
    const { items, stats } = await makeClient(fetchImpl, { limit: 100 }).fetchAllPrograms()
    expect(items).toHaveLength(2)
    expect(stats.pages).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toBe('https://api.intigriti.com/external/researcher/v1/programs?limit=100&offset=0')
    expect(sleep).not.toHaveBeenCalled()
  })

  it('VARIAS páginas: itera por offset hasta agotar maxCount, con pacing ENTRE páginas', async () => {
    const record = (n: number) => ({ ...pageFixture.records[0], id: `id-${n}`, handle: `h-${n}` })
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      const m = /offset=(\d+)/.exec(String(url))!
      const offset = Number(m[1])
      const records = offset === 0 ? [record(1), record(2)] : offset === 2 ? [record(3)] : []
      return Promise.resolve(jsonRes({ maxCount: 3, records }))
    })
    const pages: string[] = []
    const { items, stats } = await makeClient(fetchImpl, { limit: 2 }).fetchAllPrograms((p, of) => pages.push(`${p}/${of}`))
    expect(items.map((r) => r.handle)).toEqual(['h-1', 'h-2', 'h-3'])
    expect(stats.pages).toBe(2)
    expect(fetchImpl).toHaveBeenCalledTimes(2) // la 3ª llamada (offset 4, vacía) no llega a ocurrir: 2+1 = maxCount
    expect(pages.at(-1)).toBe('2/2')
    expect(sleep).toHaveBeenCalledTimes(1) // pacing solo ENTRE páginas
  })

  it('maxCount INCONSISTENTE (mayor que lo que devuelve la API): el tope de iteraciones corta el bucle', async () => {
    // Response nueva por llamada: el body solo se puede consumir una vez
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonRes({ maxCount: 10_000, records: pageFixture.records })))
    const { items, stats } = await makeClient(fetchImpl, { limit: 2, maxIterations: 5 }).fetchAllPrograms()
    expect(items).toHaveLength(10) // 5 iteraciones × 2 records
    expect(stats.pages).toBe(5)
    expect(fetchImpl).toHaveBeenCalledTimes(5)
  })

  it('offset fuera de rango (200 con records: []) no buclea', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ maxCount: 4, records: [] }))
    const { items } = await makeClient(fetchImpl).fetchAllPrograms()
    expect(items).toHaveLength(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('limit se acota al máximo del spec (500)', () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ maxCount: 0, records: [] }))
    return makeClient(fetchImpl, { limit: 99_999 }).listProgramsPage().then(() => {
      const [url] = fetchImpl.mock.calls[0] as [string]
      expect(url).toContain('limit=500')
    })
  })
})

describe('IntigritiClient · errores', () => {
  it('SIN token: error de auth ANTES de cualquier fetch (no hay endpoints públicos)', async () => {
    const fetchImpl = vi.fn()
    const client = new IntigritiClient(null, { fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.listProgramsPage()).rejects.toMatchObject({ kind: 'auth', status: 401 })
    await expect(client.getProgram('x')).rejects.toMatchObject({ kind: 'auth' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('401 → kind=auth; 500 → kind=server; 404 → kind=not_found en detalle', async () => {
    const e401 = vi.fn().mockResolvedValue(jsonRes({ code: 'UNAUTH001', title: 'Access denied.', status: 401 }, 401))
    await expect(makeClient(e401).listProgramsPage()).rejects.toMatchObject({ kind: 'auth', status: 401 })

    const e500 = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }))
    await expect(makeClient(e500).listProgramsPage()).rejects.toMatchObject({ kind: 'server', status: 500 })

    const e404 = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }))
    await expect(makeClient(e404).getProgram('no-existe')).rejects.toMatchObject({ kind: 'not_found' })
  })

  it('timeout (AbortError) → kind=timeout; JSON malformado → bad_json; forma rota → validation', async () => {
    const slow = vi.fn().mockImplementation((_u, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        )
      }),
    )
    await expect(
      new IntigritiClient(PAT, { fetchImpl: slow as unknown as typeof fetch, sleepImpl: sleep, timeoutMs: 50 }).listProgramsPage(),
    ).rejects.toMatchObject({ kind: 'timeout' })

    const badJson = vi.fn().mockResolvedValue(new Response('no json', { status: 200 }))
    await expect(makeClient(badJson).listProgramsPage()).rejects.toMatchObject({ kind: 'bad_json' })

    const roto = vi.fn().mockResolvedValue(jsonRes({ records: 'no-soy-array' }))
    await expect(makeClient(roto).listProgramsPage()).rejects.toMatchObject({ kind: 'validation' })
  })

  it('IntigritiApiError tiene name propio (para instanceof en las actions)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ code: 'UNAUTH001' }, 401))
    try {
      await makeClient(fetchImpl).listProgramsPage()
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(IntigritiApiError)
      expect((err as Error).name).toBe('IntigritiApiError')
    }
  })
})

describe('IntigritiClient · detalle y auth', () => {
  it('getProgram devuelve el ProgramDetail parseado; getProgramWithRaw conserva el CRUD', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(detailFixture))
    const p = await makeClient(fetchImpl).getProgram('00000000-0000-4000-8000-000000000001')
    expect(p.handle).toBe('anonymized-handle-1')
    expect(p.domains?.content).toHaveLength(3)
    expect(fetchImpl.mock.calls[0]![0]).toContain('/v1/programs/00000000-0000-4000-8000-000000000001')

    const { program, raw } = await makeClient(vi.fn().mockResolvedValue(jsonRes(detailFixture))).getProgramWithRaw(p.id)
    expect(program.id).toBe(p.id)
    expect(raw).toEqual(detailFixture) // condición no-lossy: CRUD intacto
  })

  it('lleva Authorization: Bearer <PAT> en la petición', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ maxCount: 0, records: [] }))
    await makeClient(fetchImpl).listProgramsPage()
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toMatchObject({ authorization: `Bearer ${PAT}` })
  })
})
