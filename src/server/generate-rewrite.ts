import { readFile } from 'node:fs/promises'
import { PathEscapeError, resolveSafe } from '@/core/fs/paths'
import { rewriteReport } from '@/core/llm/rewrite'
import { loadLlmSettings } from '@/core/llm/settings'
import { renderKbContext } from '@/core/kb/kb'
import { rebuildKbIndex, searchKb } from '@/db/kb-index'
import { splitFrontMatter, unquote } from '@/core/reports/frontmatter'
import { analyzeRewrite, type ReviewAnalysis } from '@/core/reports/review'
import { DEFAULT_TEMPLATE_NAME, findTemplate } from '@/core/reports/templates'
import { recordLlmRun } from '@/db/runs'
import { getEnv } from '@/lib/env'

/**
 * Generación de propuestas de reescritura (compartida por 8.4 y 10.1):
 * lee el fichero, resuelve la plantilla (proyecto > global), llama al LLM
 * (con registro de ejecución y coste) y calcula el análisis determinista.
 * CERO escrituras en el árbol de reportes.
 */

export interface GenerateResult {
  ok: boolean
  error?: string
  markdown?: string
  analysis?: ReviewAnalysis
  info?: { attempts: number; latencyMs: number; model?: string }
  /** Plantilla efectivamente usada (la elegida o el default 'ywh'). */
  templateUsed?: { name: string; scope: 'project' | 'global' }
}

export interface GenerateHooks {
  /**
   * Se invoca justo ANTES de gastar la llamada al LLM, con TODAS las
   * validaciones ya pasadas (settings, fichero, plantilla). 10.1 lo usa
   * para materializar la aprobación explícita del usuario: fila 'approved'
   * con el hash actual del disco.
   */
  onBeforeLlm?: (path: string) => void
}

export async function generateRewriteFor(
  path: string,
  templateName: string = DEFAULT_TEMPLATE_NAME,
  hooks: GenerateHooks = {},
  /** Slugs KB ('reporte') elegidos en la UI: contexto blindado para el LLM. */
  kbSlugs: string[] = [],
): Promise<GenerateResult> {
  const settings = loadLlmSettings()
  if (!settings || !settings.apiKey) {
    return { ok: false, error: 'Configura primero el proveedor LLM en Ajustes (8.1)' }
  }

  const root = getEnv().REPORTS_ROOT
  let original: string
  try {
    original = await readFile(resolveSafe(path, root), 'utf8')
  } catch (err) {
    if (err instanceof PathEscapeError) return { ok: false, error: err.message }
    return { ok: false, error: 'El fichero ya no está en disco' }
  }

  const project = path.includes('/') ? path.split('/')[0] : undefined
  const hit = findTemplate(templateName, { project, root })
  if (!hit) {
    return {
      ok: false,
      error: `No existe la plantilla «${templateName}» (ni global ni del proyecto)`,
    }
  }

  hooks.onBeforeLlm?.(path)

  // Contexto KB (skills 'reporte'): la selección MANUAL de 6d MÁS la
  // auto-recuperación FTS5 de 08b (sin duplicar). El contenido es DATO y va
  // blindado en el prompt (delimitadores + nonce en prompt.ts).
  let autoSlugs: string[] = []
  try {
    rebuildKbIndex(root) // índice reconstruible: fresco justo antes de buscar
    const query = buildReportKbQuery(original)
    if (query !== '') {
      autoSlugs = searchKb(query, { project, category: 'reporte', limit: 5, root }).map((h) => h.slug)
    }
  } catch {
    autoSlugs = [] // la recuperación NUNCA bloquea la reescritura
  }
  const allSlugs = [...new Set([...kbSlugs, ...autoSlugs])]
  const kbContext = allSlugs.length > 0 ? renderKbContext(allSlugs, { project, root: getEnv().REPORTS_ROOT }) : ''

  const res = await rewriteReport(original, hit.content, {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    kbContext,
  })

  // 8.9: registrar la ejecución (éxito o fallo) con tokens, duración y coste
  recordLlmRun({
    path,
    model: settings.model,
    attempts: res.ok ? res.info.attempts : res.attempts,
    latencyMs: res.ok ? res.info.latencyMs : res.latencyMs,
    promptTokens: res.ok ? res.info.usage?.promptTokens : undefined,
    completionTokens: res.ok ? res.info.usage?.completionTokens : undefined,
    status: res.ok ? 'ok' : res.kind,
    error: res.ok ? undefined : res.error,
  })

  if (!res.ok) {
    return {
      ok: false,
      error:
        res.kind === 'validation'
          ? `Propuesta rechazada por el validador: ${res.error}`
          : `Error del proveedor (${res.attempts} intento(s), ${res.latencyMs} ms): ${res.error}`,
    }
  }

  return {
    ok: true,
    markdown: res.markdown,
    analysis: analyzeRewrite(original, res.markdown, hit.content),
    info: { attempts: res.info.attempts, latencyMs: res.info.latencyMs, model: res.info.model },
    templateUsed: { name: hit.name, scope: hit.scope },
  }
}

// ── Auto-recuperación KB (08b): query desde el reporte ─────────────────

const KB_QUERY_STOP = new Set([
  'informe', 'report', 'summary', 'resumen', 'ejecutivo', 'executive',
  'impacto', 'impact', 'remediation', 'remediación', 'references',
  'referencias', 'finding', 'hallazgo', 'pasos', 'reproducción',
  'reproduction', 'severity', 'crítico', 'critical', 'high', 'low', 'medium',
  'description', 'vulnerable', 'code',
])

/**
 * Query FTS derivada del reporte (título/secciones/identificadores):
 * identificadores CVE/CWE primero (señal fuerte), luego palabras de
 * encabezados y título (≥4 chars, sin stopwords). Tope 12 términos en OR.
 */
export function buildReportKbQuery(original: string): string {
  if (typeof original !== 'string' || original.trim() === '') return ''
  const terms: string[] = []
  const push = (word: string): void => {
    const t = word.toLowerCase()
    if (t.length >= 4 && !KB_QUERY_STOP.has(t) && !terms.includes(t)) terms.push(t)
  }

  for (const m of original.matchAll(/\b(?:CVE-\d{4}-\d{4,}|CWE-\d{1,5})\b/g)) {
    // identificadores SIN lowercase: son literales de búsqueda (FTS5 es
    // case-insensitive al comparar, pero la query conserva su forma canónica)
    const id = m[0]
    if (!terms.some((t) => t.toLowerCase() === id.toLowerCase())) terms.push(id)
  }

  const split = splitFrontMatter(original)
  if (split.hasFm) {
    for (const line of split.lines) {
      const m = /^title\s*:\s*(.*)$/.exec(line)
      if (m) {
        for (const w of unquote(m[1]!.trim()).split(/[^A-Za-z0-9À-ÿ]+/)) push(w)
        break
      }
    }
  }
  for (const m of original.matchAll(/^#{1,3}\s+(.+)$/gm)) {
    for (const w of m[1]!.split(/[^A-Za-z0-9À-ÿ]+/)) push(w)
  }
  return terms.slice(0, 12).join(' OR ')
}
