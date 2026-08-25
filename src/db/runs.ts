import { desc } from 'drizzle-orm'
import { estimateCostUsd } from '../core/llm/pricing'
import { defaultDbPath, openDb } from './db'
import { llmRuns } from './schema'

/**
 * Registro de ejecuciones LLM (8.9): alta y listado. El coste se estima
 * aquí (pricing tabulado + fallback por familia); si no es deducible,
 * queda null y la UI muestra "no deducible" en vez de inventar.
 */

export interface LlmRunInput {
  path: string | null
  model: string
  attempts: number
  latencyMs: number
  promptTokens?: number
  completionTokens?: number
  status: 'ok' | string
  error?: string
}

export function recordLlmRun(input: LlmRunInput, dbPath: string = defaultDbPath()): number {
  const db = openDb(dbPath)
  try {
    const cost = estimateCostUsd(input.model, input.promptTokens, input.completionTokens)
    const res = db
      .insert(llmRuns)
      .values({
        path: input.path,
        model: input.model,
        attempts: input.attempts,
        latencyMs: input.latencyMs,
        promptTokens: input.promptTokens ?? null,
        completionTokens: input.completionTokens ?? null,
        costUsd: cost?.usd ?? null,
        costBasis: cost?.basis ?? null,
        status: input.status,
        error: input.error ?? null,
      })
      .run()
    return Number(res.lastInsertRowid)
  } finally {
    db.$client.close()
  }
}

/** Últimas ejecuciones, de más reciente a más antigua. */
export function listLlmRuns(limit = 50, dbPath: string = defaultDbPath()) {
  const db = openDb(dbPath)
  try {
    return db.select().from(llmRuns).orderBy(desc(llmRuns.id)).limit(limit).all()
  } finally {
    db.$client.close()
  }
}
