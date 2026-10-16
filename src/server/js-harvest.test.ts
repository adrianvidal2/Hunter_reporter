import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { harvestJs } from './js-harvest'

let root: string
const created: string[] = []

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'js-harvest-'))
  created.push(root)
  mkdirSync(join(root, 'demo'), { recursive: true }) // proyecto
})

afterAll(() => {
  for (const p of created) rmSync(p, { recursive: true, force: true })
})

const SCOPE = ['*.ejemplo.com']
const JS_URL = 'https://app.ejemplo.com/static/app.min.js'

const SOURCES = {
  app: 'export const answer = 42',
  util: 'export const id = (x) => x',
  passwd: 'root:x:0:0:root:/root:/bin/bash',
}

/** Map con 3 fuentes (una "sensible" que el aplanado mantiene CONTENIDA). */
const MAP = JSON.stringify({
  version: 3,
  sources: ['webpack:///./src/app.ts', './lib/util.ts', '../../etc/passwd'],
  sourcesContent: [SOURCES.app, SOURCES.util, SOURCES.passwd],
})

function inlineMap(mapJson: string): string {
  return `code();\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(mapJson).toString('base64')}\n`
}

function fetchWith(routes: Record<string, { body: string; status?: number }>): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async (url: string) => {
    const r = routes[url]
    if (!r) return new Response('not found', { status: 404 })
    return new Response(r.body, { status: r.status ?? 200, headers: { 'content-type': 'application/javascript' } })
  })
}

/** Paseo recursivo de TODOS los ficheros escritos bajo el dir de salida. */
function walkRecursively(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name)
    if (e.isDirectory()) out.push(...walkRecursively(abs))
    else out.push(abs)
  }
  return out
}

describe('harvestJs (recolección + reconstrucción, fetch inyectado)', () => {
  it('inline sourcemap → fuentes reconstruidas BYTE A BYTE y contenidas; coverage.json', async () => {
    const fetchMock = fetchWith({ [JS_URL]: { body: inlineMap(MAP) } })
    const res = await harvestJs(
      { project: 'demo', urls: [JS_URL], scope: SCOPE, fetchImpl: fetchMock as unknown as typeof fetch, root },
    )
    expect(res.ok).toBe(true)
    const outDir = join(root, res.outputDir!)
    expect(existsSync(outDir)).toBe(true)

    // cobertura honesta: reconstruido con las 3 fuentes
    expect(res.coverage).toHaveLength(1)
    expect(res.coverage![0]).toMatchObject({ url: JS_URL, status: 'reconstructed', sources: 3, reconstructed: 3 })
    expect(res.stats).toMatchObject({ js: 1, withMap: 1, reconstructed: 1, gaps: 0 })

    // byte a byte
    const srcDir = join(outDir, 'src', '0')
    expect(readFileSync(join(srcDir, 'src/app.ts'), 'utf8')).toBe(SOURCES.app)
    expect(readFileSync(join(srcDir, 'lib/util.ts'), 'utf8')).toBe(SOURCES.util)
    // la fuente "sensible" queda CONTENIDA en el dir de salida (aplanada: etc/passwd)
    expect(readFileSync(join(srcDir, 'etc/passwd'), 'utf8')).toBe(SOURCES.passwd)

    // NADA escrito fuera del dir de salida (walk completo con prefijo)
    const all = walkRecursively(outDir)
    expect(all.length).toBeGreaterThan(3)
    for (const f of all) expect(f.startsWith(outDir + '/')).toBe(true)
    expect(existsSync('/etc/passwd')).toBe(true) // el sistema no fue tocado (obvio, pero explícito)

    // coverage.json persistido
    const coverage = JSON.parse(readFileSync(join(outDir, 'coverage.json'), 'utf8')) as { stats: unknown; coverage: unknown[] }
    expect(coverage.stats).toMatchObject({ js: 1, reconstructed: 1 })
    expect(coverage.coverage).toHaveLength(1)
  })

  it('sourcemap REMOTA (.map): un GET extra, el map se persiste y se reconstruye', async () => {
    const MAP_URL = 'https://app.ejemplo.com/static/app.min.js.map'
    const fetchMock = fetchWith({
      [JS_URL]: { body: 'code();\n//# sourceMappingURL=app.min.js.map\n' },
      [MAP_URL]: { body: MAP },
    })
    const res = await harvestJs({ project: 'demo', urls: [JS_URL], scope: SCOPE, fetchImpl: fetchMock as unknown as typeof fetch, root })
    expect(res.ok).toBe(true)
    expect(res.coverage![0]).toMatchObject({ status: 'reconstructed', mapUrl: MAP_URL, reconstructed: 3 })
    expect(existsSync(join(root, res.outputDir!, 'maps', readdirSync(join(root, res.outputDir!, 'maps'))[0]!))).toBe(true)
    // 2 llamadas: el JS y su map
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('sin sourceMappingURL → hueco no-map (el JS se guarda igual)', async () => {
    const fetchMock = fetchWith({ [JS_URL]: { body: 'var x = 1;' } })
    const res = await harvestJs({ project: 'demo', urls: [JS_URL], scope: SCOPE, fetchImpl: fetchMock as unknown as typeof fetch, root })
    expect(res.coverage![0]!.status).toBe('no-map')
    expect(res.stats!.gaps).toBe(1)
    expect(existsSync(join(root, res.outputDir!, 'js'))).toBe(true)
  })

  it('map malformado → map-invalid sin crash; map sin sourcesContent → hueco', async () => {
    const broken = await harvestJs({
      project: 'demo', urls: [JS_URL], scope: SCOPE,
      fetchImpl: fetchWith({ [JS_URL]: { body: inlineMap('{roto') } }) as unknown as typeof fetch, root,
    })
    expect(broken.coverage![0]!.status).toBe('map-invalid')

    const noContent = await harvestJs({
      project: 'demo', urls: [JS_URL], scope: SCOPE,
      fetchImpl: fetchWith({ [JS_URL]: { body: inlineMap(JSON.stringify({ version: 3, sources: ['a.ts'] })) } }) as unknown as typeof fetch, root,
    })
    expect(noContent.coverage![0]).toMatchObject({ status: 'map-without-content', sources: 1, reconstructed: 0 })
  })

  it('errores de red/HTTP → fetch-error; JS enorme → skipped-large', async () => {
    const failed = await harvestJs({
      project: 'demo', urls: [JS_URL], scope: SCOPE,
      fetchImpl: fetchWith({ [JS_URL]: { body: 'boom', status: 500 } }) as unknown as typeof fetch, root,
    })
    expect(failed.coverage![0]).toMatchObject({ status: 'fetch-error', error: 'HTTP 500' })

    const big = await harvestJs({
      project: 'demo', urls: [JS_URL], scope: SCOPE,
      fetchImpl: fetchWith({ [JS_URL]: { body: 'x'.repeat(5 * 1024 * 1024 + 1) } }) as unknown as typeof fetch, root,
    })
    expect(big.coverage![0]!.status).toBe('skipped-large')
  })

  it('scope: nada fuera de scope se descarga (y queda en la cobertura)', async () => {
    const FUERA = 'https://fuera.ejemplo.net/x.js'
    const fetchMock = fetchWith({ [JS_URL]: { body: 'var ok = 1' }, [FUERA]: { body: 'var no' } })
    const res = await harvestJs({
      project: 'demo', urls: [JS_URL, FUERA], scope: SCOPE,
      fetchImpl: fetchMock as unknown as typeof fetch, root,
    })
    expect(res.coverage).toHaveLength(2)
    expect(res.coverage!.find((e) => e.url === FUERA)).toMatchObject({ status: 'out-of-scope' })
    // el fetch del fuera-de-scope jamás ocurrió
    const calledUrls = fetchMock.mock.calls.map((c) => c[0] as string)
    expect(calledUrls).not.toContain(FUERA)
  })

  it('07b: endpoints literales → openapi.json; dinámicos → gaps.json (sin inventar)', async () => {
    const map = JSON.stringify({
      version: 3,
      sources: ['src/api.ts'],
      sourcesContent: [
        [
          'fetch("/api/v1/users?page=1")',
          'fetch("/api/v1/login", { method: "POST", body: JSON.stringify({ user: 1 }) })',
          'fetch(`/api/users/${userId}`)', // dinámico → gap
        ].join('\n'),
      ],
    })
    const fetchMock = fetchWith({ [JS_URL]: { body: inlineMap(map) } })
    const res = await harvestJs({ project: 'demo', urls: [JS_URL], scope: SCOPE, fetchImpl: fetchMock as unknown as typeof fetch, root })
    expect(res.ok).toBe(true)
    expect(res.api).toEqual({ endpoints: 2, gaps: 1 })

    const outDir = join(root, res.outputDir!)
    const openapi = JSON.parse(readFileSync(join(outDir, 'openapi.json'), 'utf8')) as {
      openapi: string
      servers?: { url: string }[]
      paths: Record<string, Record<string, { 'x-recon': { from: string[] } }>>
    }
    expect(openapi.openapi).toBe('3.0.3')
    expect(Object.keys(openapi.paths).sort()).toEqual(['/api/v1/login', '/api/v1/users'])
    expect(openapi.servers?.[0]?.url).toBe('https://app.ejemplo.com')
    // x-recon cita la FUENTE RECONSTRUIDA (no el minificado)
    expect(openapi.paths['/api/v1/users'].get['x-recon'].from[0]).toContain('src/api.ts')

    const gaps = JSON.parse(readFileSync(join(outDir, 'gaps.json'), 'utf8')) as {
      gaps: { reason: string; snippet: string }[]
    }
    expect(gaps.gaps).toHaveLength(1)
    expect(gaps.gaps[0]).toMatchObject({ reason: 'dynamic-template' })
    expect(gaps.gaps[0]!.snippet).toContain('${userId}')
  })

  it('07b: sin map, los literales del JS CRUDO también alimentan el OpenAPI', async () => {
    const fetchMock = fetchWith({ [JS_URL]: { body: 'fetch("/api/health")\n//# sourceMappingURL=no-existe.map\n' } })
    const res = await harvestJs({ project: 'demo', urls: [JS_URL], scope: SCOPE, fetchImpl: fetchMock as unknown as typeof fetch, root })
    // el map remoto no existe (map-fetch-error) pero el JS crudo aporta el endpoint
    expect(res.coverage![0]!.status).toBe('map-fetch-error')
    expect(res.api!.endpoints).toBe(1)
    const openapi = JSON.parse(readFileSync(join(root, res.outputDir!, 'openapi.json'), 'utf8')) as {
      paths: Record<string, unknown>
    }
    expect(openapi.paths['/api/health']).toBeDefined()
  })

  it('07c: secretos accionables → candidatos; Maps key → ruido; secrets.json persistido', async () => {
    const js = [
      'const cfg = {',
      `  aws: "AKIAQWMHXN3FAKEKEY99",`, // candidato
      `  maps: "AIzaSyA1234567890abcdefghijklmnopqrstuv",`, // ruido explícito
      '  route: "/api/internal/health"',
      '}',
    ].join('\n')
    const fetchMock = fetchWith({ [JS_URL]: { body: js } })
    const res = await harvestJs({ project: 'demo', urls: [JS_URL], scope: SCOPE, fetchImpl: fetchMock as unknown as typeof fetch, root })
    expect(res.secrets).toEqual({ candidates: 1, noise: 1 })

    const secrets = JSON.parse(readFileSync(join(root, res.outputDir!, 'secrets.json'), 'utf8')) as {
      stats: { candidates: number; noise: number }
      findings: { kind: string; confidence: string; value: string; source: string }[]
    }
    expect(secrets.stats).toEqual({ candidates: 1, noise: 1 })
    const aws = secrets.findings.find((f) => f.kind === 'aws-access-key')!
    expect(aws.confidence).toBe('candidato')
    expect(aws.source).toBe(JS_URL)
    expect(secrets.findings.find((f) => f.kind === 'google-api-key')!.confidence).toBe('probable-ruido')
  })
})
