import { statSync } from 'node:fs'
import path from 'node:path'
import { realpathSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { sha256File } from '../core/fs/hash'
import { resolveSafe } from '../core/fs/paths'
import { openDb, defaultDbPath } from './db'
import { pendingActions, type PendingAction } from './schema'

/**
 * Altas idempotentes en `pending_actions` (paso 6.2).
 *
 * Semántica por (path, hash):
 * - path nuevo → INSERT ('inserted')
 * - mismo path, mismo hash → NOP: nada cambia, ni detectedAt ('noop')
 * - mismo path, hash distinto (el fichero volvió a cambiar) → UPDATE de
 *   hash/size/mtime/detectedAt, SIGUE siendo una sola fila ('updated')
 *
 * Así un watcher que re-emita el mismo fichero no genera ruido, y un cambio
 * real refresca la detección sin duplicar la entrada.
 */

export type PendingOutcome = 'inserted' | 'updated' | 'noop'

export interface PendingInput {
  path: string
  hash: string
  size: number
  mtimeMs: number
}

export function registerPending(
  input: PendingInput,
  dbPath: string = defaultDbPath(),
): PendingOutcome {
  const db = openDb(dbPath)
  try {
    return db.transaction((tx) => {
      const existing = tx
        .select()
        .from(pendingActions)
        .where(eq(pendingActions.path, input.path))
        .get()

      if (!existing) {
        tx.insert(pendingActions).values(input).run()
        return 'inserted'
      }
      if (existing.hash === input.hash) return 'noop'

      tx.update(pendingActions)
        .set({ ...input, detectedAt: new Date() })
        .where(eq(pendingActions.path, input.path))
        .run()
      return 'updated'
    })
  } finally {
    db.$client.close()
  }
}

/**
 * Pegamento watcher→BD: dado un absPath dentro de root, calcula
 * hash/size/mtime y hace el alta idempotente con su relPath.
 */
export function registerPendingFile(
  absPath: string,
  root: string,
  dbPath: string = defaultDbPath(),
): PendingOutcome {
  const rel = path
    .relative(realpathSync(root), realpathSync(absPath))
    .split(path.sep)
    .join('/')
  const st = statSync(absPath)
  return registerPending(
    { path: rel, hash: sha256File(absPath), size: st.size, mtimeMs: Math.round(st.mtimeMs) },
    dbPath,
  )
}

/** Pendientes sin resolver, por orden de detección. */
export function listPending(dbPath: string = defaultDbPath()) {
  const db = openDb(dbPath)
  try {
    return db
      .select()
      .from(pendingActions)
      .where(eq(pendingActions.status, 'pending'))
      .orderBy(pendingActions.detectedAt)
      .all()
  } finally {
    db.$client.close()
  }
}

/** Fila de pendiente por path (cualquier estado), o undefined. */
export function getPendingAction(
  path: string,
  dbPath: string = defaultDbPath(),
): PendingAction | undefined {
  const db = openDb(dbPath)
  try {
    return db.select().from(pendingActions).where(eq(pendingActions.path, path)).get()
  } finally {
    db.$client.close()
  }
}

/**
 * 10.1 — Materializa la aprobación EXPLÍCITA del usuario para reescribir
 * un borrador desde la UI: upsert con status='approved' y el hash ACTUAL
 * del disco (línea base para el guard de hash del Accept de 8.5).
 *
 * Invariante 6.5 intacta: el watcher nunca escribe 'approved' (solo crea
 * 'pending'); esta función solo la invoca una acción humana (clic en
 * «Generar» desde Borradores). Fichero inexistente → error de fs, BD intacta.
 */
export function markManuallyApproved(
  path: string,
  root: string,
  dbPath: string = defaultDbPath(),
): void {
  const absPath = resolveSafe(path, root)
  const st = statSync(absPath)
  const input: PendingInput = {
    path,
    hash: sha256File(absPath),
    size: st.size,
    mtimeMs: Math.round(st.mtimeMs),
  }
  const db = openDb(dbPath)
  try {
    db.transaction((tx) => {
      const existing = tx.select().from(pendingActions).where(eq(pendingActions.path, path)).get()
      if (!existing) {
        tx.insert(pendingActions).values({ ...input, status: 'approved' }).run()
      } else {
        tx.update(pendingActions)
          .set({ ...input, status: 'approved', detectedAt: new Date() })
          .where(eq(pendingActions.path, path))
          .run()
      }
    })
  } finally {
    db.$client.close()
  }
}

/**
 * Transición de estado por decisión humana (6.4/6.5): 'approved' abre el
 * flujo de reescritura (bloque 8), 'discarded' lo cierra. Nada se ejecuta
 * por arte de la detección: solo esta llamada explícita cambia el estado.
 * @returns true si la fila existía y se actualizó.
 */
export function resolvePending(
  path: string,
  decision: 'approved' | 'discarded',
  dbPath: string = defaultDbPath(),
): boolean {
  const db = openDb(dbPath)
  try {
    const res = db
      .update(pendingActions)
      .set({ status: decision })
      .where(eq(pendingActions.path, path))
      .run()
    return res.changes > 0
  } finally {
    db.$client.close()
  }
}
