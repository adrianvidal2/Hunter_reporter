import { classifyFindings, type ClassifiableFinding, type ClassifyRunInfo } from '@/core/recon/classify'
import { loadLlmSettings } from '@/core/llm/settings'
import { applyTriage, listFindings } from '@/db/findings'
import { recordLlmRun } from '@/db/runs'

/**
 * Triaje LLM de los findings de un proyecto (Tarea 4), compartido por la
 * server action y sus tests:
 *
 * 1. settings LLM obligatorios (Ajustes).
 * 2. índice de findings del proyecto (listFindings).
 * 3. classifyFindings (pre-filtro + chat con anti-inyección, por lotes).
 * 4. registro de la PASADA en llm_runs (tokens/coste/estado), haya ido o
 *    no algo al LLM (una pasada sin candidatos no llama y no gasta: fila
 *    solo si hubo llamada o error).
 * 5. applyTriage: SOLO actualiza la marca de filas existentes; ningún
 *    camino borra o crea findings.
 */

export interface ClassifyProjectResult {
  ok: boolean
  error?: string
  /** Findings que el pre-filtro marcó sin gasto de tokens. */
  prefiltro?: number
  /** Findings que llegaron al LLM. */
  sent?: number
  /** Filas marcadas en el índice (= filas existentes actualizadas). */
  marked?: number
  /** Reparto de marcas: humano decide. */
  labels?: { real: number; ruido: number; dudoso: number }
  info?: ClassifyRunInfo | null
}

export interface ClassifyProjectOptions {
  /** Inyectables para tests. */
  dbPath?: string
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
  batchSize?: number
  timeoutMs?: number
}

export async function classifyProjectFindings(
  project: string,
  opts: ClassifyProjectOptions = {},
): Promise<ClassifyProjectResult> {
  const settings = loadLlmSettings()
  if (!settings || !settings.apiKey) {
    return { ok: false, error: 'Configura primero el proveedor LLM en Ajustes' }
  }

  const rows = listFindings(project, { dbPath: opts.dbPath })
  const candidates: ClassifiableFinding[] = rows.map((r) => ({
    templateId: r.templateId,
    host: r.host,
    severity: r.severity as ClassifiableFinding['severity'],
    name: r.name ?? undefined,
    matchedAt: r.matchedAt ?? undefined,
  }))

  const res = await classifyFindings(candidates, {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    fetchImpl: opts.fetchImpl,
    sleepImpl: opts.sleepImpl,
    batchSize: opts.batchSize,
    timeoutMs: opts.timeoutMs,
  })

  // Registro de la PASADA (8.9): fila solo si hubo llamada al LLM. El path
  // identifica la operación (no es un fichero del árbol).
  if (res.info !== null) {
    recordLlmRun(
      {
        path: `findings:${project}`,
        model: settings.model,
        attempts: res.info.attempts,
        latencyMs: res.info.latencyMs,
        promptTokens: res.info.usage?.promptTokens,
        completionTokens: res.info.usage?.completionTokens,
        status: res.status,
        error: res.error,
      },
      opts.dbPath,
    )
  }

  if (res.status !== 'ok') {
    return {
      ok: false,
      error: res.error ?? 'El triaje LLM falló; los findings quedan sin marca definitiva',
      prefiltro: res.verdicts.filter((v) => v.via === 'prefiltro').length,
      sent: res.sent,
      info: res.info,
    }
  }

  // Persistir la marca: SOLO UPDATE de filas existentes (nunca borra).
  const marks = rows.map((r, i) => ({
    templateId: r.templateId,
    host: r.host,
    label: res.verdicts[i]!.label,
    confianza: res.verdicts[i]!.confianza,
    razon: res.verdicts[i]!.razon,
  }))
  const marked = applyTriage(project, marks, opts.dbPath)

  const labels = { real: 0, ruido: 0, dudoso: 0 }
  for (const v of res.verdicts) labels[v.label]++

  return {
    ok: true,
    prefiltro: res.verdicts.filter((v) => v.via === 'prefiltro').length,
    sent: res.sent,
    marked,
    labels,
    info: res.info,
  }
}
