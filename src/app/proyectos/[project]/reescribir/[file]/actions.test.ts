import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFixture, type Fixture } from '../../../../../test/fixtures/fixture'
import { sha256File } from '@/core/fs/hash'
import { rewriteReport } from '@/core/llm/rewrite'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ REPORTS_ROOT: env.root }),
}))
const cfg = vi.hoisted(() => ({
  settings: { provider: 'custom', baseUrl: 'https://x/v1', apiKey: 'k', model: 'test-model' },
}))
vi.mock('@/core/llm/settings', () => ({
  loadLlmSettings: () => cfg.settings,
}))
vi.mock('@/core/llm/rewrite', () => ({
  rewriteReport: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { generateDraftRewriteAction } from './actions'
import { acceptRewriteAction } from '@/app/pendientes/actions'
import { getPendingAction } from '@/db/pending'
import { saveTemplate } from '@/core/reports/templates'

const REL = 'demo_project/reportes/informe-idor.md'

describe('generateDraftRewriteAction (10.1)', () => {
  let fx: Fixture
  let dbPath: string

  beforeEach(() => {
    fx = createFixture()
    env.root = fx.root
    dbPath = path.join(fx.root, 'index.db')
    process.env.DB_PATH = dbPath
    vi.mocked(rewriteReport).mockReset()
    return () => {
      delete process.env.DB_PATH
      fx.cleanup()
    }
  })

  it('materializa la aprobación explícita (fila approved + hash del disco) y envía la plantilla ELEGIDA al prompt', async () => {
    saveTemplate('alt', '# ALT\n\n## Executive Summary\n\n{{resumen}}', fx.root, 'demo_project')
    vi.mocked(rewriteReport).mockResolvedValue({
      ok: true,
      markdown: '# Rewritten\n\n## Executive Summary\n\nx',
      info: { attempts: 1, latencyMs: 5, model: 'test-model' },
    })

    const res = await generateDraftRewriteAction(REL, 'alt')

    expect(res.ok).toBe(true)
    expect(res.templateUsed).toEqual({ name: 'alt.md', scope: 'project' })

    // la fila quedó aprobada con el hash real del disco (línea base del Accept)
    const row = getPendingAction(REL, dbPath)
    expect(row?.status).toBe('approved')
    expect(row?.hash).toBe(sha256File(fx.mdFrontMatter))

    // la plantilla elegida es la que va al prompt
    expect(rewriteReport).toHaveBeenCalledTimes(1)
    const [original, templateContent] = vi.mocked(rewriteReport).mock.calls[0] as unknown as [
      string,
      string,
    ]
    expect(original).toContain('IDOR')
    expect(templateContent).toContain('# ALT')
  })

  it('plantilla inexistente → error con el nombre, CERO aprobación y CERO llamadas LLM', async () => {
    const res = await generateDraftRewriteAction(REL, 'no-existe')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/no-existe/)
    expect(getPendingAction(REL, dbPath)).toBeUndefined() // no aprobó nada
    expect(rewriteReport).not.toHaveBeenCalled()
  })

  it('flujo completo del borrador: generar (aprobar) → Aceptar guarda y archiva el original', async () => {
    saveTemplate('alt', '# ALT\n\n## Executive Summary\n\n{{resumen}}', fx.root, 'demo_project')
    const original = readFileSync(fx.mdFrontMatter, 'utf8')
    vi.mocked(rewriteReport).mockResolvedValue({
      ok: true,
      markdown: '# Rewritten EN\n\n## Executive Summary\n\nx',
      info: { attempts: 1, latencyMs: 5, model: 'test-model' },
    })

    const gen = await generateDraftRewriteAction(REL, 'alt')
    expect(gen.ok).toBe(true)

    const acc = await acceptRewriteAction(REL, gen.markdown!)
    expect(acc.ok, acc.error).toBe(true)

    // el fichero contiene la propuesta; el original está en .history/ (recuperable)
    expect(readFileSync(fx.mdFrontMatter, 'utf8')).toBe(gen.markdown)
    const histDir = path.join(fx.root, '.history/demo_project/reportes/informe-idor.md')
    const entries = readdirSync(histDir)
    expect(entries).toHaveLength(1)
    expect(readFileSync(path.join(histDir, entries[0]!), 'utf8')).toBe(original)
    expect(getPendingAction(REL, dbPath)?.status).toBe('approved')
  })

  it('sin settings LLM → error y sin aprobación', async () => {
    const prev = cfg.settings
    ;(cfg as { settings: unknown }).settings = null
    try {
      const res = await generateDraftRewriteAction(REL)
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/Ajustes/)
      expect(getPendingAction(REL, dbPath)).toBeUndefined()
    } finally {
      ;(cfg as { settings: unknown }).settings = prev
    }
  })
})
