import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveLlmSettings } from '@/core/llm/settings'
import { upsertFindings, listFindings } from '@/db/findings'
import { listLlmRuns } from '@/db/runs'
import { classifyProjectFindings } from './classify-findings'

/**
 * Triaje sobre la BD REAL en tmpdir (patrón de los tests del runner):
 * settingsDir() y la BD viven en tmpdirs; el fetch es mock. Nada toca
 * datos reales.
 */

let workDir: string
const created: string[] = []
const originalCwd = process.cwd()

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'classify-'))
  created.push(workDir)
  // settingsDir() = cwd/.settings → tmpdir propio
  process.chdir(mkdtempSync(join(tmpdir(), 'classify-settings-')))
})

afterAll(() => {
  process.chdir(originalCwd)
  for (const p of created) rmSync(p, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(join(process.cwd(), '.settings', 'llm.json'), { force: true })
})

function ok(content: string, usage: { prompt_tokens?: number; completion_tokens?: number } = { prompt_tokens: 10, completion_tokens: 4 }) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], model: 'test-model', usage }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

const F = (over: Record<string, string> = {}) => ({
  templateId: 'sqli-error-based',
  host: 'api.ejemplo.com',
  severity: 'high' as const,
  name: 'SQL Injection',
  ...over,
})

function mockFetch(content: string): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(ok(content))
}

describe('classifyProjectFindings (triaje con registro y sin auto-descarte)', () => {
  it('sin settings LLM → error claro y CERO llamadas', async () => {
    const fetchMock = vi.fn()
    const res = await classifyProjectFindings('demo', { dbPath: join(workDir, 'db.sqlite'), fetchImpl: fetchMock as unknown as typeof fetch })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/Ajustes/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('pasada feliz: pre-filtro + LLM; marca SIN borrar; queda en llm_runs', async () => {
    const dbPath = join(workDir, 'feliz.sqlite')
    saveLlmSettings({ provider: 'custom', baseUrl: 'https://api.test/v1', model: 'deepseek-chat', apiKey: 'sk-test' })
    // 1 info (pre-filtro), 2 para el LLM
    upsertFindings('demo', 'nuclei', 'd1', [
      { templateId: 'tech-detect', host: 'a.ejemplo.com', severity: 'info' },
      { templateId: 'sqli-error-based', host: 'b.ejemplo.com', severity: 'high' },
      { templateId: 'open-redirect', host: 'c.ejemplo.com', severity: 'medium' },
    ], dbPath)

    const fetchMock = mockFetch(JSON.stringify([
      { id: '0', label: 'real', confianza: 0.9, razon: 'payload en respuesta' },
      { id: '1', label: 'ruido', confianza: 0.7, razon: 'redirect benigno' },
    ]))
    const res = await classifyProjectFindings('demo', { dbPath, fetchImpl: fetchMock as unknown as typeof fetch })

    expect(res.ok).toBe(true)
    expect(res.prefiltro).toBe(1)
    expect(res.sent).toBe(2)
    expect(res.marked).toBe(3) // TODOS quedan marcados
    expect(res.labels).toEqual({ real: 1, ruido: 2, dudoso: 0 }) // el ruido del prefiltro cuenta

    // NUNCA auto-descarta: siguen las TRES filas, solo cambió la marca
    const rows = listFindings('demo', { dbPath })
    expect(rows).toHaveLength(3)
    const byTemplate = new Map(rows.map((r) => [r.templateId, r]))
    expect(byTemplate.get('sqli-error-based')).toMatchObject({ triageLabel: 'real', triageConfianza: 0.9 })
    expect(byTemplate.get('open-redirect')).toMatchObject({ triageLabel: 'ruido' })
    expect(byTemplate.get('tech-detect')).toMatchObject({ triageLabel: 'ruido', triageRazon: expect.stringContaining('Pre-filtro') })
    expect(byTemplate.get('tech-detect')!.triagedAt).not.toBeNull()

    // registro: UNA fila en llm_runs con tokens/coste/estado
    const runs = listLlmRuns(10, dbPath)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      path: 'findings:demo',
      model: 'deepseek-chat',
      status: 'ok',
      promptTokens: 10,
      completionTokens: 4,
    })
    expect(runs[0]!.costUsd).not.toBeNull()
  })

  it('salida basura del LLM → todo dudoso (jamás ruido), registro con estado ok', async () => {
    const dbPath = join(workDir, 'basura.sqlite')
    saveLlmSettings({ provider: 'custom', baseUrl: 'https://api.test/v1', model: 'test-model', apiKey: 'sk-test' })
    upsertFindings('demo', 'nuclei', 'd1', [F()], dbPath)

    const fetchMock = mockFetch('lo siento, no puedo responder en JSON')
    const res = await classifyProjectFindings('demo', { dbPath, fetchImpl: fetchMock as unknown as typeof fetch })
    expect(res.ok).toBe(true)
    expect(res.labels).toEqual({ real: 0, ruido: 0, dudoso: 1 })
    expect(listFindings('demo', { dbPath })[0]).toMatchObject({ triageLabel: 'dudoso', triageConfianza: 0 })
    expect(listLlmRuns(10, dbPath)[0]!.status).toBe('ok')
  })

  it('fallo del LLM (401) → sin marcas definitivas; llm_runs registra el error', async () => {
    const dbPath = join(workDir, 'fallo.sqlite')
    saveLlmSettings({ provider: 'custom', baseUrl: 'https://api.test/v1', model: 'test-model', apiKey: 'sk-bad' })
    upsertFindings('demo', 'nuclei', 'd1', [F()], dbPath)

    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"nope"}', { status: 401 }))
    const res = await classifyProjectFindings('demo', { dbPath, fetchImpl: fetchMock as unknown as typeof fetch })

    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/401/)
    // sin marca definitiva: el finding queda como estaba (sin triaje)
    const rows = listFindings('demo', { dbPath })
    expect(rows).toHaveLength(1) // nada borrado
    expect(rows[0]!.triageLabel).toBeNull()
    expect(rows[0]!.triagedAt).toBeNull()
    // el fallo queda en el log
    const runs = listLlmRuns(10, dbPath)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.status).toBe('auth')
    expect(runs[0]!.error).toMatch(/401/)
  })

  it('pasada sin candidatos (todo pre-filtrado o sin findings) → sin llamada y sin fila', async () => {
    const dbPath = join(workDir, 'vacio.sqlite')
    saveLlmSettings({ provider: 'custom', baseUrl: 'https://api.test/v1', model: 'test-model', apiKey: 'sk-test' })
    mkdirSync(workDir, { recursive: true })

    const fetchMock = vi.fn()
    const res = await classifyProjectFindings('sin-findings', { dbPath, fetchImpl: fetchMock as unknown as typeof fetch })
    expect(res.ok).toBe(true)
    expect(res.sent).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(listLlmRuns(10, dbPath)).toHaveLength(0) // nada que registrar
  })
})
