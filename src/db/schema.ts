import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Índice SQLite (bloque 2). El sistema de ficheros es la verdad: estas
 * tablas son un índice RECONSTRUIBLE — `reindex()` puede borrarlas y
 * repoblarlas desde el disco en cualquier momento (2.2/2.3).
 */

export const projects = sqliteTable('projects', {
  /** Nombre del directorio de primer nivel dentro de REPORTS_ROOT. */
  name: text('name').primaryKey(),
  /** Momento de la última indexación del proyecto. */
  indexedAt: integer('indexed_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export const files = sqliteTable('files', {
  /** Ruta relativa a REPORTS_ROOT con separadores '/'. */
  path: text('path').primaryKey(),
  /** Proyecto (primer segmento de path). Cascade: si el proyecto se borra
   *  del índice, sus ficheros también. */
  project: text('project')
    .notNull()
    .references(() => projects.name, { onDelete: 'cascade' }),
  /** SHA-256 del contenido, hex. */
  hash: text('hash').notNull(),
  /** Tamaño en bytes. */
  size: integer('size').notNull(),
  /** mtime en milisegundos Unix. */
  mtimeMs: integer('mtime_ms', { mode: 'number' }).notNull(),
  /** Entregado (REPORTES_YWH) o borrador (reportes). */
  kind: text('kind', { enum: ['pdf', 'md'] }).notNull(),
})

export type Project = typeof projects.$inferSelect
export type FileRow = typeof files.$inferSelect

/**
 * Reportes nuevos detectados por el watcher, a la espera de decisión
 * humana (bloque 6). Alta idempotente por (path, hash): el mismo fichero
 * detectado dos veces deja UNA fila.
 */
export const pendingActions = sqliteTable('pending_actions', {
  /** Ruta relativa a REPORTS_ROOT (PK: un fichero pendiente por ruta). */
  path: text('path').primaryKey(),
  /** sha-256 del contenido en el momento de la detección. */
  hash: text('hash').notNull(),
  size: integer('size').notNull(),
  mtimeMs: integer('mtime_ms', { mode: 'number' }).notNull(),
  detectedAt: integer('detected_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  /** Sin aprobación no se ejecuta nada (6.5). */
  status: text('status', { enum: ['pending', 'approved', 'discarded'] })
    .notNull()
    .default('pending'),
})

export type PendingAction = typeof pendingActions.$inferSelect

/**
 * Registro de ejecuciones LLM (8.9): modelo, tokens, duración y coste
 * ESTIMADO cuando el pricing lo permite deducir. Es un log operativo: si
 * se pierde, no se pierde trabajo del usuario.
 */
export const llmRuns = sqliteTable('llm_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  /** Fichero reescrito (o null en ejecuciones sin fichero). */
  path: text('path'),
  model: text('model').notNull(),
  attempts: integer('attempts').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  /** Coste estimado en USD (null = no deducible). */
  costUsd: real('cost_usd'),
  /** Cómo se estimó el coste. */
  costBasis: text('cost_basis'),
  /** 'ok' o el kind de error (auth/rate_limit/timeout/validation…). */
  status: text('status').notNull(),
  error: text('error'),
})

export type LlmRun = typeof llmRuns.$inferSelect
