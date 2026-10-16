import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from '@/lib/env'
import { resolveSafe } from '@/core/fs/paths'
import { chatCompletion, LlmApiError } from '@/core/llm/client'
import { loadLlmSettings } from '@/core/llm/settings'
import { createKb, loadKbEntry } from '@/core/kb/kb'
import type { JsEndpoint, JsEndpointGap } from '@/core/recon/js-endpoints'
import {
  buildKbQuery,
  buildPrimitivesPrompt,
  deriveDeterministicPrimitives,
  parseHypotheses,
  type DeterministicPrimitive,
  type Hypothesis,
  type PrimitivesPromptData,
} from '@/core/recon/primitives'
import { rebuildKbIndex, searchKb } from '../db/kb-index'
import { recordLlmRun } from '@/db/runs'

/**
 * Deriva primitivas + hipótesis sobre la salida determinista de 07a–07c
 * (Tarea 7d) y las persiste como KB de PROYECTO (categoría 'tecnica',
 * recuperables por el FTS de 6e).
 *
 * - DETERMINISTA PRIMERO: las primitivas obvias salen sin LLM (siempre).
 * - El LLM SOLO añade hipótesis priorizadas (leads best-effort, jamás
 *   confirmaciones). Fallo/salida basura del LLM → degradación segura:
 *   las deterministas ya están en la KB, cero hipótesis.
 * - Registro en llm_runs SOLO si hubo llamada.
 */

const MAX_KB_ENTRIES = 30
const RETRY_KINDS = new Set(['rate_limit', 'server', 'network'])
const BACKOFF_MS = [2_000, 8_000]

export interface DerivePrimitivesInput {
  project: string
  /** Dir de harvest (salida 07a-c) RELATIVO a REPORTS_ROOT: openapi.json + gaps.json + secrets.json. */
  harvestDirRel: string
  dbPath?: string
  root?: string
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
  timeoutMs?: number
}

export interface DerivePrimitivesResult {
  ok: boolean
  error?: string
  /** Primitivas deterministas (sin LLM, siempre). */
  deterministic?: number
  /** Hipótesis del LLM (0 si no hubo llamada o la salida fue inservible). */
  hypotheses?: number
  /** Slugs KB creados en el proyecto. */
  kbSlugs?: string[]
  llmCalled?: boolean
  llmError?: string
}

interface HarvestArtifacts {
  endpoints: JsEndpoint[]
  gaps: JsEndpointGap[]
  secrets: { kind: string; value: string; confidence: string }[]
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])

/** Lee openapi.json + gaps.json + secrets.json del dir de harvest (tolerante).
 *  Exportado también para la semilla de misión (7e). */
export function readHarvestArtifacts(dirAbs: string): HarvestArtifacts {
  const out: HarvestArtifacts = { endpoints: [], gaps: [], secrets: [] }

  const openapiRel = path.join(dirAbs, 'openapi.json')
  if (existsSync(openapiRel)) {
    try {
      const doc = JSON.parse(readFileSync(openapiRel, 'utf8')) as {
        paths?: Record<string, Record<string, { parameters?: { name?: string; in?: string }[]; requestBody?: { content?: { 'application/json'?: { schema?: { properties?: Record<string, unknown> } } } } }>>
      }
      for (const [pathKey, methods] of Object.entries(doc.paths ?? {})) {
        for (const [method, op] of Object.entries(methods ?? {})) {
          if (!HTTP_METHODS.has(method.toLowerCase())) continue
          const query = (op.parameters ?? [])
            .filter((p) => p.in === 'query' && typeof p.name === 'string')
            .map((p) => p.name!)
          const bodyProps = Object.keys(
            op.requestBody?.content?.['application/json']?.schema?.properties ?? {},
          )
          out.endpoints.push({ method: method.toLowerCase() as JsEndpoint['method'], path: pathKey, queryParams: query, bodyProps, from: ['openapi.json'] })
        }
      }
    } catch {
      /* openapi corrupto: endpoints vacíos, el resto sigue */
    }
  }

  const gapsRel = path.join(dirAbs, 'gaps.json')
  if (existsSync(gapsRel)) {
    try {
      const parsed = JSON.parse(readFileSync(gapsRel, 'utf8')) as { gaps?: { reason?: string; snippet?: string }[] }
      out.gaps = (parsed.gaps ?? [])
        .filter((g) => typeof g.snippet === 'string')
        .map((g) => ({ reason: (g.reason ?? 'dynamic-template') as JsEndpointGap['reason'], snippet: g.snippet!, from: 'gaps.json' }))
    } catch {
      /* gaps corrupto: vacío */
    }
  }

  const secretsRel = path.join(dirAbs, 'secrets.json')
  if (existsSync(secretsRel)) {
    try {
      const parsed = JSON.parse(readFileSync(secretsRel, 'utf8')) as {
        findings?: { kind?: string; confidence?: string; value?: string }[]
      }
      out.secrets = (parsed.findings ?? [])
        .filter((f) => typeof f.value === 'string' && typeof f.kind === 'string')
        .map((f) => ({ kind: f.kind!, value: f.value!, confidence: f.confidence ?? 'candidato' }))
    } catch {
      /* secrets corrupto: vacío */
    }
  }

  return out
}

const STAMP = (d = new Date()): string =>
  d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6)

export async function derivePrimitivesFor(input: DerivePrimitivesInput): Promise<DerivePrimitivesResult> {
  const root = input.root ?? getEnv().REPORTS_ROOT
  const dbPath = input.dbPath ?? undefined // defaultDbPath() dentro de runs/kb

  let dirAbs: string
  try {
    dirAbs = resolveSafe(input.harvestDirRel, root)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Ruta de harvest inválida' }
  }
  const artifacts = readHarvestArtifacts(dirAbs)
  if (artifacts.endpoints.length === 0 && artifacts.gaps.length === 0 && artifacts.secrets.length === 0) {
    return { ok: false, error: `No hay artifacts de harvest utilizables en ${input.harvestDirRel} (¿ejecutaste 07a-c?)` }
  }

  // 1) DETERMINISTA PRIMERO: primitivas obvias sin LLM.
  const deterministic = deriveDeterministicPrimitives(artifacts)

  // 2) LLM: solo lo difuso (priorización/hipótesis). Sin settings → solo determinista.
  const settings = loadLlmSettings()
  let hypotheses: Hypothesis[] = []
  let llmCalled = false
  let llmError: string | undefined

  if (settings && settings.apiKey) {
    // 08a — recuperar KB 'tecnica' relevante ANTES de juzgar (léxico-primero,
    // FTS5). El índice es reconstruible: se refresca justo antes de buscar.
    // La recuperación NUNCA bloquea el triaje: cualquier fallo → sin contexto.
    let kbContext = ''
    try {
      rebuildKbIndex(root, dbPath)
      const query = buildKbQuery(artifacts)
      if (query !== '') {
        const hits = searchKb(query, { project: input.project, category: 'tecnica', limit: 5, root, dbPath })
        kbContext = hits
          .map((h) => loadKbEntry(h.slug, { project: input.project, root }).body)
          .filter((b) => b.trim() !== '')
          .join('\n\n')
      }
    } catch {
      kbContext = ''
    }

    const promptData: PrimitivesPromptData = {
      endpoints: artifacts.endpoints,
      gaps: artifacts.gaps,
      secrets: artifacts.secrets,
      deterministic,
      kbContext,
    }
    const { system, user } = buildPrimitivesPrompt(promptData)
    const sleep = input.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
    const fetchImpl = input.fetchImpl ?? fetch
    const start = Date.now()
    let attempts = 0
    let content: string | null = null
    let lastErr: unknown

    for (let i = 0; i <= BACKOFF_MS.length; i++) {
      attempts++
      try {
        const res = await chatCompletion(
          {
            baseUrl: settings.baseUrl,
            apiKey: settings.apiKey,
            model: settings.model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            temperature: 0,
            maxTokens: 4096,
            timeoutMs: input.timeoutMs ?? 120_000,
          },
          fetchImpl,
        )
        content = res.content
        lastErr = undefined
        break
      } catch (err) {
        lastErr = err
        const retryable = err instanceof LlmApiError && RETRY_KINDS.has(err.kind) && i < BACKOFF_MS.length
        if (!retryable) break
        await sleep(BACKOFF_MS[i]!)
      }
    }
    llmCalled = true
    const latencyMs = Date.now() - start

    if (lastErr !== undefined || content === null) {
      llmError = lastErr instanceof Error ? lastErr.message : 'Error desconocido del LLM'
      recordLlmRun(
        {
          path: `js-primitivas:${input.project}`,
          model: settings.model,
          attempts: attempts,
          latencyMs,
          status: lastErr instanceof LlmApiError ? lastErr.kind : 'network',
          error: llmError,
        },
        dbPath,
      )
    } else {
      hypotheses = parseHypotheses(content)
      recordLlmRun(
        {
          path: `js-primitivas:${input.project}`,
          model: settings.model,
          attempts: attempts,
          latencyMs,
          status: 'ok',
        },
        dbPath,
      )
    }
  }

  // 3) Persistencia: primitivas + hipótesis como KB DE PROYECTO (lead, sin confirmar).
  const stamp = STAMP()
  const kbSlugs: string[] = []
  const entries: { kind: string; body: string; description: string }[] = []

  for (const p of deterministic as DeterministicPrimitive[]) {
    entries.push({
      kind: p.kind,
      description: `Primitiva JS (${p.kind}) sobre ${p.target} — lead sin confirmar (07d)`,
      body: [
        `## Primitiva: ${p.kind}`,
        '',
        `- **Target:** ${p.target}`,
        `- **Señal determinista:** ${p.signal}`,
        '- **Naturaleza:** lead best-effort. SIN confirmar: requiere verificación manual.',
        '',
        '> Derivada del análisis estático de JS (07a-c + pre-filtro 7d). Nunca es un hecho.',
      ].join('\n'),
    })
  }
  for (const h of hypotheses as Hypothesis[]) {
    entries.push({
      kind: h.kind,
      description: `Hipótesis LLM (${h.kind}, p=${Math.round(h.probabilidad * 100)}%) ${h.target} — lead sin confirmar (07d)`,
      body: [
        `## Hipótesis: ${h.title}`,
        '',
        `- **Kind:** ${h.kind}`,
        `- **Target:** ${h.target || '—'}`,
        `- **Probabilidad (LLM):** ${Math.round(h.probabilidad * 100)}%`,
        `- **Razón:** ${h.razon || '—'}`,
        '- **Naturaleza:** lead best-effort generado por LLM. NUNCA confirmado: verificar antes de creer.',
        '',
        '> El LLM prioriza, no confirma. Lo dinámico se verifica con pruebas reales.',
      ].join('\n'),
    })
  }

  for (const [i, entry] of entries.entries()) {
    if (kbSlugs.length >= MAX_KB_ENTRIES) break
    const slug = `js-${entry.kind}-${i + 1}-${stamp}`
    const created = createKb(
      {
        name: slug,
        description: entry.description,
        category: 'tecnica',
        tags: ['js-audit', entry.kind, 'lead'],
        body: entry.body,
      },
      { scope: input.project, root },
    )
    kbSlugs.push(created.slug)
  }

  return {
    ok: true,
    deterministic: deterministic.length,
    hypotheses: hypotheses.length,
    kbSlugs,
    llmCalled,
    ...(llmError !== undefined ? { llmError } : {}),
  }
}
