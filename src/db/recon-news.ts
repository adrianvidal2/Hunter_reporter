import { and, desc, eq } from 'drizzle-orm'
import { defaultDbPath, openDb } from './db'
import { reconNews, type ReconNewsRow } from './schema'

/**
 * Store de novedades de monitorización (Tarea 9b): assets NUEVOS que el
 * diff entre ciclos del scheduler registra. Alta idempotente por
 * (proyecto, herramienta, item): lo ya visto no vuelve a avisar (solo
 * refresca lastSeenAt). ÍNDICE RECONSTRUIBLE: los output.log son la verdad.
 */

export interface ReconNewsInput {
  project: string
  tool: string
  items: string[]
}

export interface RecordNewsResult {
  /** Items NUEVOS (primera vez): los que generan aviso. */
  inserted: number
  /** Items ya conocidos: solo refresco de lastSeenAt. */
  refreshed: number
}

export function recordReconNews(
  project: string,
  tool: string,
  items: string[],
  dbPath: string = defaultDbPath(),
): RecordNewsResult {
  const db = openDb(dbPath)
  try {
    return db.transaction((tx) => {
      let inserted = 0
      let refreshed = 0
      const now = new Date()
      for (const rawItem of items) {
        const item = rawItem.trim()
        if (item === '') continue
        const existing = tx
          .select({ id: reconNews.id })
          .from(reconNews)
          .where(
            and(eq(reconNews.project, project), eq(reconNews.tool, tool), eq(reconNews.item, item)),
          )
          .get()
        if (!existing) {
          tx.insert(reconNews).values({ project, tool, item, firstSeenAt: now, lastSeenAt: now }).run()
          inserted++
          continue
        }
        tx.update(reconNews).set({ lastSeenAt: now }).where(eq(reconNews.id, existing.id)).run()
        refreshed++
      }
      return { inserted, refreshed }
    })
  } finally {
    db.$client.close()
  }
}

export interface ListReconNewsOptions {
  project?: string
  limit?: number
  dbPath?: string
}

/** Novedades recientes, global o por proyecto, de más nuevas a más viejas. */
export function listReconNews(opts: ListReconNewsOptions = {}): ReconNewsRow[] {
  const db = openDb(opts.dbPath ?? defaultDbPath())
  try {
    const base = db.select().from(reconNews)
    const query = opts.project ? base.where(eq(reconNews.project, opts.project)) : base
    return query.orderBy(desc(reconNews.lastSeenAt), desc(reconNews.id)).limit(opts.limit ?? 100).all()
  } finally {
    db.$client.close()
  }
}

/** Vacía el índice de un proyecto (o todo): es reconstruible, no es verdad. */
export function clearReconNews(project: string | undefined, dbPath: string = defaultDbPath()): number {
  const db = openDb(dbPath)
  try {
    const res = project
      ? db.delete(reconNews).where(eq(reconNews.project, project)).run()
      : db.delete(reconNews).run()
    return res.changes
  } finally {
    db.$client.close()
  }
}
