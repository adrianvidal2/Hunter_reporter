import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { listKbIndex, loadKbEntry } from '@/core/kb/kb'
import { listLlmRuns } from '@/db/runs'
import { derivePrimitivesFor } from './derive-primitives'

/**
 * Orquestador 7d con settingsDir + BD + KB en tmpdir (nada toca datos
 * reales). El LLM es fetch inyectado; el sleep de backoff, inyectado.
 */

let workRoot: string
let harvestDirRel: string
const originalCwd = process.cwd()
const created: string[] = []

beforeAll(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'derive-'))
  created.push(workRoot)
  harvestDirRel = 'demo/pentest/recon/js/20260101-000000'
  process.chdir(mkdtempSync(join(tmpdir(), 'derive-settings-')))
})

afterAll(() => {
  process.chdir(originalCwd)
  for (const p of created) rmSync(p, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(join(process.cwd(), '.settings', 'llm.json'), { force: true })
  rmSync(join(workRoot, '.config'), { recursive: true, force: true })
  rmSync(join(workRoot, 'demo', '.config'), { recursive: true, force: true })
  rmSync(join(workRoot, 'demo', 'pentest'), { recursive: true, force: true })
  mkdirSync(join(workRoot, harvestDirRel), { recursive: true })
  // artifacts deterministas de 07a-c
  writeFileSync(
    join(workRoot, harvestDirRel, 'openapi.json'),
    JSON.stringify({
      openapi: '3.0.3',
      paths: {
        '/api/v1/users/{id}': { get: { parameters: [{ name: 'id', in: 'query' }] } },
        '/admin/console': { get: {} },
        '/static/logo.svg': { get: {} },
      },
    }),
  )
  writeFileSync(join(workRoot, harvestDirRel, 'gaps.json'), JSON.stringify({ gaps: [] }))
  writeFileSync(
    join(workRoot, harvestDirRel, 'secrets.json'),
    JSON.stringify({
      findings: [{ kind: 'aws-access-key', confidence: 'candidato', value: 'AKIAQWMHXN3FAKEKEY99' }],
    }),
  )
})

function okFetch(content: string, usage = { prompt_tokens: 12, completion_tokens: 30 }): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async () => {
    return new Response(
      JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], model: 'test-model', usage }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  })
}

const HYPOTHESES_JSON = JSON.stringify([
  { title: 'BOLA en users', kind: 'bola', target: 'GET /api/v1/users/{id}', probabilidad: 0.9, razon: 'id secuencial' },
])

describe('derivePrimitivesFor (pre-filtro sin LLM + hipótesis con LLM)', () => {
  it('sin settings → primitivas deterministas en la KB de proyecto, CERO llamadas y sin llm_runs', async () => {
    const fetchMock = vi.fn()
    const dbPath = join(workRoot, 'a.db')
    const res = await derivePrimitivesFor(
      { project: 'demo', harvestDirRel, dbPath, root: workRoot, fetchImpl: fetchMock as unknown as typeof fetch },
    )
    expect(res.ok).toBe(true)
    expect(res.deterministic!).toBeGreaterThanOrEqual(3) // bola+sqli del {id} + auth + admin + secreto
    expect(res.hypotheses).toBe(0)
    expect(res.llmCalled).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()

    // persistidas como KB DE PROYECTO (recuperables por 6a/6e)
    const kb = listKbIndex({ project: 'demo', root: workRoot })
    expect(kb.length).toBe(res.kbSlugs!.length)
    expect(kb.every((e) => e.scope === 'project' && e.category === 'tecnica')).toBe(true)
    const entry = loadKbEntry(res.kbSlugs![0]!, { project: 'demo', root: workRoot })
    expect(entry.body).toMatch(/lead best-effort/i)
    expect(entry.body).toMatch(/SIN confirmar/i)

    expect(listLlmRuns(10, dbPath)).toHaveLength(0)
  })

  it('con settings → hipótesis del LLM persistidas; llm_runs registra la pasada', async () => {
    const { saveLlmSettings } = await import('@/core/llm/settings')
    saveLlmSettings({ provider: 'custom', baseUrl: 'https://api.test/v1', model: 'deepseek-chat', apiKey: 'sk-test' })
    const dbPath = join(workRoot, 'b.db')
    const fetchMock = okFetch(HYPOTHESES_JSON)

    const res = await derivePrimitivesFor(
      { project: 'demo', harvestDirRel, dbPath, root: workRoot, fetchImpl: fetchMock as unknown as typeof fetch },
    )
    expect(res.ok).toBe(true)
    expect(res.llmCalled).toBe(true)
    expect(res.hypotheses).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // el prompt LLEVÓ los datos escapados (anti-inyección en el cable real)
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1]!.body as string) as {
      messages: { role: string; content: string }[]
    }
    const user = body.messages.find((m) => m.role === 'user')!.content
    expect(user).toContain('<JS_RECON_DATA n="')
    expect(user).toContain('/api/v1/users/{id}')

    // la hipótesis está en la KB con su descargo de responsabilidad
    const hypSlug = res.kbSlugs!.find((s) =>
      loadKbEntry(s, { project: 'demo', root: workRoot }).body.includes('Hipótesis: BOLA en users'),
    )!
    const entry = loadKbEntry(hypSlug, { project: 'demo', root: workRoot })
    expect(entry.body).toMatch(/NUNCA confirmado/i)
    expect(entry.body).toContain('BOLA en users')

    const runs = listLlmRuns(10, dbPath)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ path: 'js-primitivas:demo', status: 'ok' })
  })

  it('salida basura del LLM → degradación segura: deterministas persistidas, 0 hipótesis', async () => {
    const { saveLlmSettings } = await import('@/core/llm/settings')
    saveLlmSettings({ provider: 'custom', baseUrl: 'https://api.test/v1', model: 'deepseek-chat', apiKey: 'sk-test' })
    const dbPath = join(workRoot, 'c.db')
    const fetchMock = okFetch('lo siento, no tengo hipótesis en JSON')

    const res = await derivePrimitivesFor(
      { project: 'demo', harvestDirRel, dbPath, root: workRoot, fetchImpl: fetchMock as unknown as typeof fetch },
    )
    expect(res.ok).toBe(true)
    expect(res.hypotheses).toBe(0)
    expect(res.deterministic!).toBeGreaterThanOrEqual(3)
    // NADA marcado como confirmado: la KB solo tiene leads con disclaimer
    for (const slug of res.kbSlugs!) {
      expect(loadKbEntry(slug, { project: 'demo', root: workRoot }).body).toMatch(/sin confirmar|NUNCA confirmado/i)
    }
    expect(listLlmRuns(10, dbPath)[0]!.status).toBe('ok')
  })

  it('fallo del LLM (401) → degradación segura + fila con el error; deterministas intactas', async () => {
    const { saveLlmSettings } = await import('@/core/llm/settings')
    saveLlmSettings({ provider: 'custom', baseUrl: 'https://api.test/v1', model: 'deepseek-chat', apiKey: 'sk-bad' })
    const dbPath = join(workRoot, 'd.db')
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"nope"}', { status: 401 }))

    const res = await derivePrimitivesFor(
      { project: 'demo', harvestDirRel, dbPath, root: workRoot, fetchImpl: fetchMock as unknown as typeof fetch },
    )
    expect(res.ok).toBe(true)
    expect(res.llmError).toMatch(/401/)
    expect(res.hypotheses).toBe(0)
    expect(res.kbSlugs!.length).toBe(res.deterministic) // las deterministas siguen en la KB
    const runs = listLlmRuns(10, dbPath)
    expect(runs[0]!.status).toBe('auth')
    expect(runs[0]!.error).toMatch(/401/)
  })

  it('harvest sin artifacts → error claro, nada persistido', async () => {
    mkdirSync(join(workRoot, 'demo/pentest/recon/js/vacio'), { recursive: true })
    const res = await derivePrimitivesFor({
      project: 'demo', harvestDirRel: 'demo/pentest/recon/js/vacio', dbPath: join(workRoot, 'e.db'), root: workRoot,
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/artifacts/i)
    expect(listKbIndex({ project: 'demo', root: workRoot })).toHaveLength(0)
  })

  it('cap de entradas KB: nunca inunda la base de conocimiento', async () => {
    // muchos endpoints con id → muchas primitivas deterministas; el cap las limita
    const manyPaths: Record<string, unknown> = {}
    for (let i = 0; i < 60; i++) manyPaths[`/api/v${i}/users/${i}`] = { get: {} }
    writeFileSync(join(workRoot, harvestDirRel, 'openapi.json'), JSON.stringify({ paths: manyPaths }))
    writeFileSync(join(workRoot, harvestDirRel, 'gaps.json'), JSON.stringify({ gaps: [] }))
    writeFileSync(join(workRoot, harvestDirRel, 'secrets.json'), JSON.stringify({ findings: [] }))

    const res = await derivePrimitivesFor({
      project: 'demo', harvestDirRel, dbPath: join(workRoot, 'f.db'), root: workRoot,
    })
    expect(res.deterministic!).toBeGreaterThan(30)
    expect(res.kbSlugs!.length).toBeLessThanOrEqual(30)
    expect(listKbIndex({ project: 'demo', root: workRoot }).length).toBeLessThanOrEqual(30)
  })

  it('readArtifacts tolera artifacts corruptos sin romper (solo tiene lo legible)', async () => {
    writeFileSync(join(workRoot, harvestDirRel, 'openapi.json'), '{roto')
    writeFileSync(join(workRoot, harvestDirRel, 'secrets.json'), JSON.stringify({ findings: [{ kind: 'jwt', confidence: 'candidato', value: 'eyJx.eyJx.eyJx' }] }))
    const res = await derivePrimitivesFor({
      project: 'demo', harvestDirRel, dbPath: join(workRoot, 'g.db'), root: workRoot,
    })
    expect(res.ok).toBe(true)
    // el secreto legible sí generó primitiva aunque el openapi estuviera roto
    expect(res.deterministic!).toBe(1)
  })
})
