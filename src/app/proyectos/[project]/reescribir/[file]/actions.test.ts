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
import { createKb } from '@/core/kb/kb'
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

  it('los slugs KB marcados llegan como kbContext al LLM; sin marcar → auto-contexto (6d+08b)', async () => {
    saveTemplate('alt', '# ALT\n\n## Executive Summary\n\n{{resumen}}', fx.root, 'demo_project')
    await createKb(
      {
        name: 'remediation-idor',
        description: 'Remediación estándar de IDOR.',
        category: 'reporte',
        body: 'CUERPO-KB-REMEDIATION',
      },
      { scope: 'demo_project', root: fx.root },
    )
    vi.mocked(rewriteReport).mockResolvedValue({
      ok: true,
      markdown: '# Rewritten\n\n## Executive Summary\n\nx',
      info: { attempts: 1, latencyMs: 5, model: 'test-model' },
    })

    await generateDraftRewriteAction(REL, 'alt', ['remediation-idor'])
    const [, , withKb] = vi.mocked(rewriteReport).mock.calls[0] as unknown as [
      string,
      string,
      { kbContext?: string },
    ]
    expect(withKb.kbContext).toContain('CUERPO-KB-REMEDIATION')

    // sin marcar (08b): la AUTO-recuperación FTS5 trae la entrada relevante
    vi.mocked(rewriteReport).mockClear()
    await generateDraftRewriteAction(REL, 'alt')
    const [, , withoutKb] = vi.mocked(rewriteReport).mock.calls[0] as unknown as [
      string,
      string,
      { kbContext?: string },
    ]
    expect(withoutKb.kbContext).toContain('CUERPO-KB-REMEDIATION')
  })
})

describe('auto-contexto KB en la reescritura (08b: searchKb + unión sin duplicar)', () => {
  beforeEach(() => {
    vi.mocked(rewriteReport).mockClear()
    const fx = createFixture()
    env.root = fx.root
    process.env.DB_PATH = path.join(fx.root, 'index.db')
    saveTemplate('alt', '# ALT\n\n## Executive Summary\n\n{{resumen}}', fx.root, 'demo_project')
    return () => {
      delete process.env.DB_PATH
      fx.cleanup()
    }
  })

  it('recupera entradas reporte relevantes SIN selección manual y las pasa como kbContext', async () => {
    await createKb(
      {
        name: 'auto-remediation-idor',
        description: 'Remediación de IDOR: comparar objetos entre usuarios.',
        category: 'reporte',
        body: 'CUERPO-AUTO-REMEDIATION-IDOR',
      },
      { scope: 'demo_project', root: env.root },
    )
    vi.mocked(rewriteReport).mockResolvedValue({
      ok: true,
      markdown: '# R\n\n## Executive Summary\n\nx',
      info: { attempts: 1, latencyMs: 5, model: 'test-model' },
    })

    // SIN kbSlugs manuales: la auto-recuperación hace el trabajo
    await generateDraftRewriteAction(REL, 'alt')
    const [,, opts] = vi.mocked(rewriteReport).mock.calls[0] as unknown as [
      string,
      string,
      { kbContext?: string },
    ]
    expect(opts.kbContext).toContain('CUERPO-AUTO-REMEDIATION-IDOR')
  })

  it('une manual + auto SIN duplicar; sin hits ni selección → kbContext vacío', async () => {
    // 'both' coincide con la query del reporte (heading IDOR) Y va marcado a mano
    await createKb(
      {
        name: 'both-entry',
        description: 'Remediación IDOR duplicada a propósito.',
        category: 'reporte',
        body: 'CUERPO-BOTH-ENTRY',
      },
      { scope: 'demo_project', root: env.root },
    )
    await createKb(
      {
        name: 'manual-entry',
        description: 'Entrada elegida a mano que NO coincide con la query.',
        category: 'reporte',
        body: 'CUERPO-MANUAL-ENTRY',
      },
      { scope: 'demo_project', root: env.root },
    )
    vi.mocked(rewriteReport).mockResolvedValue({
      ok: true,
      markdown: '# R\n\n## Executive Summary\n\nx',
      info: { attempts: 1, latencyMs: 5, model: 'test-model' },
    })

    await generateDraftRewriteAction(REL, 'alt', ['both-entry', 'manual-entry'])
    const [,, opts] = vi.mocked(rewriteReport).mock.calls[0] as unknown as [
      string,
      string,
      { kbContext?: string },
    ]
    expect(opts.kbContext).toContain('CUERPO-BOTH-ENTRY')
    expect(opts.kbContext).toContain('CUERPO-MANUAL-ENTRY')
    // sin duplicar: el cuerpo de 'both' aparece UNA sola vez
    expect(opts.kbContext!.match(/CUERPO-BOTH-ENTRY/g)).toHaveLength(1)

    // sin hits ni selección (KB sin entradas que casen): SIN bloque
    vi.mocked(rewriteReport).mockClear()
    await generateDraftRewriteAction(REL, 'alt', ['manual-entry'])
    const [,, solo] = vi.mocked(rewriteReport).mock.calls[0] as unknown as [
      string,
      string,
      { kbContext?: string },
    ]
    expect(solo.kbContext).toContain('CUERPO-MANUAL-ENTRY')
  })

  it('buildReportKbQuery: identificadores y títulos primero; stopwords y vacío fuera', async () => {
    const { buildReportKbQuery } = await import('@/server/generate-rewrite')
    const report = [
      '---',
      'title: "IDOR en panel de administración"',
      '---',
      '# IDOR en panel',
      '',
      '## Executive Summary',
      '',
      'Referencia CVE-2024-1234 y CWE-639.',
    ].join('\n')
    const query = buildReportKbQuery(report)
    expect(query.toLowerCase()).toContain('cve-2024-1234')
    expect(query.toLowerCase()).toContain('cwe-639')
    expect(query).toContain('idor')
    expect(query).toContain('panel')
    // stopwords fuera
    expect(query.toLowerCase()).not.toMatch(/\bsummary\b/)
    expect(query.toLowerCase()).not.toMatch(/\bexecutive\b/)
    expect(buildReportKbQuery('')).toBe('')
  })
})
