import { readFile } from 'node:fs/promises'
import { PathEscapeError, resolveSafe } from '@/core/fs/paths'
import { rewriteReport } from '@/core/llm/rewrite'
import { loadLlmSettings } from '@/core/llm/settings'
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
): Promise<GenerateResult> {
  const settings = loadLlmSettings()
  if (!settings || !settings.apiKey) {
    return { ok: false, error: 'Configura primero el proveedor LLM en Ajustes (8.1)' }
  }

  let original: string
  try {
    original = await readFile(resolveSafe(path, getEnv().REPORTS_ROOT), 'utf8')
  } catch (err) {
    if (err instanceof PathEscapeError) return { ok: false, error: err.message }
    return { ok: false, error: 'El fichero ya no está en disco' }
  }

  const project = path.includes('/') ? path.split('/')[0] : undefined
  const hit = findTemplate(templateName, { project, root: getEnv().REPORTS_ROOT })
  if (!hit) {
    return {
      ok: false,
      error: `No existe la plantilla «${templateName}» (ni global ni del proyecto)`,
    }
  }

  hooks.onBeforeLlm?.(path)

  const res = await rewriteReport(original, hit.content, {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
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
