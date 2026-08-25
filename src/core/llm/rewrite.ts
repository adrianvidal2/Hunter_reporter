import { chatCompletion, LlmApiError } from './client'
import { buildRewritePrompt } from './prompt'

/**
 * Llamada de reescritura (8.2) con política de errores del checkpoint 8.0.
 *
 * - CERO escrituras en disco: devuelve la propuesta en memoria.
 * - Reintentos SOLO en 429/5xx/error de red: 2 intentos con backoff 2s/8s.
 *   401, bad_request, bad_json, empty y timeout NO se reintentan.
 * - La salida se valida contra la PLANTILLA (en inglés): rechazo duro si
 *   está vacía/truncada, contiene ecos del prompt, o no contiene NINGÚN
 *   encabezado de la plantilla.
 */

export class RewriteValidationError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'RewriteValidationError'
  }
}

export interface RewriteSuccess {
  ok: true
  /** Markdown propuesto (en inglés, según regla 6 del checkpoint). */
  markdown: string
  /** Diagnóstico del intento ganador. */
  info: { attempts: number; latencyMs: number; model?: string; usage?: { promptTokens?: number; completionTokens?: number } }
}

export type RewriteFailure =
  | { ok: false; kind: 'llm'; error: string; attempts: number; latencyMs: number }
  | { ok: false; kind: 'validation'; error: string; attempts: number; latencyMs: number }

export type RewriteResult = RewriteSuccess | RewriteFailure

export interface RewriteCallOptions {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs?: number
  /** Para tests: fetch inyectable. */
  fetchImpl?: typeof fetch
  /** Para tests: espera inyectable (backoff). */
  sleepImpl?: (ms: number) => Promise<void>
}

/** Encabezados de plantilla: líneas `#`…`##` sin placeholders. */
function templateHeadings(template: string): string[] {
  return template
    .split('\n')
    .filter((l) => /^#{1,3}\s+/.test(l) && !l.includes('{{'))
    .map((l) => l.replace(/^#{1,3}\s+/, '').trim())
}

/**
 * Validación de la propuesta (8.2 + rechazo duro del checkpoint).
 * @throws RewriteValidationError
 */
export function validateRewriteOutput(markdown: string, templateContent: string): void {
  if (markdown.trim() === '') throw new RewriteValidationError('La propuesta está vacía')
  if (markdown.includes('<REPORTE_ORIGINAL') || markdown.includes('</PLANTILLA>') || markdown.includes('<PLANTILLA>')) {
    throw new RewriteValidationError('La propuesta contiene restos de los delimitadores del prompt (posible eco de inyección)')
  }
  // fence exterior que envuelve TODO el documento
  if (/^```[\w-]*\n[\s\S]*\n```$/.test(markdown.trim())) {
    throw new RewriteValidationError('La propuesta envuelve todo el documento en un bloque de código')
  }
  const headings = markdown
    .split('\n')
    .filter((l) => /^#{1,3}\s+/.test(l))
    .map((l) => l.replace(/^#{1,3}\s+/, '').trim())
  const required = templateHeadings(templateContent)
  const hit = required.some((h) => headings.some((hh) => hh === h || hh.startsWith(`${h} —`) || hh.startsWith(`${h} `)))
  if (!hit) {
    throw new RewriteValidationError(
      `La propuesta no sigue la plantilla: no contiene ningún encabezado de esta (${required.slice(0, 4).join(' / ')}…)`,
    )
  }
}

const RETRY_KINDS = new Set(['rate_limit', 'server', 'network'])
const BACKOFF_MS = [2_000, 8_000]

export async function rewriteReport(
  reportContent: string,
  templateContent: string,
  opts: RewriteCallOptions,
): Promise<RewriteResult> {
  const { system, user } = buildRewritePrompt(reportContent, templateContent)
  const sleep = opts.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const fetchImpl = opts.fetchImpl ?? fetch
  const start = Date.now()
  let attempts = 0
  let lastErr: unknown

  for (let i = 0; i <= BACKOFF_MS.length; i++) {
    attempts++
    try {
      const res = await chatCompletion(
        {
          baseUrl: opts.baseUrl,
          apiKey: opts.apiKey,
          model: opts.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.2,
          maxTokens: 32768,
          timeoutMs: opts.timeoutMs ?? 120_000,
        },
        fetchImpl,
      )
      if (res.finishReason === 'length') {
        lastErr = new RewriteValidationError('Respuesta truncada por límite de tokens (finish_reason=length)')
        throw lastErr
      }
      validateRewriteOutput(res.content, templateContent)
      return {
        ok: true,
        markdown: res.content,
        info: { attempts, latencyMs: Date.now() - start, model: res.model, usage: res.usage },
      }
    } catch (err) {
      lastErr = err
      const retryable =
        err instanceof LlmApiError && RETRY_KINDS.has(err.kind) && i < BACKOFF_MS.length
      if (!retryable) break
      await sleep(BACKOFF_MS[i]!)
    }
  }

  const latencyMs = Date.now() - start
  if (lastErr instanceof RewriteValidationError) {
    return { ok: false, kind: 'validation', error: lastErr.message, attempts, latencyMs }
  }
  const e = lastErr instanceof LlmApiError ? lastErr : undefined
  return {
    ok: false,
    kind: 'llm',
    error: e?.message ?? (lastErr instanceof Error ? lastErr.message : 'Error desconocido'),
    attempts,
    latencyMs,
  }
}
