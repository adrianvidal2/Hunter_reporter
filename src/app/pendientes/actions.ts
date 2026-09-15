'use server'

import { revalidatePath } from 'next/cache'
import { writeAtomic } from '@/core/fs/atomic'
import { sha256Content } from '@/core/fs/hash'
import { markOwnWrite } from '@/server/own-writes'
import { sha256File } from '@/core/fs/hash'
import { saveHistoryCopy } from '@/core/fs/history'
import { PathEscapeError, resolveSafe } from '@/core/fs/paths'
import { getPendingAction, resolvePending } from '@/db/pending'
import { notifyPendingCount } from '@/server/watcher-service'
import { generateRewriteFor, type GenerateResult } from '@/server/generate-rewrite'
import { getEnv } from '@/lib/env'

export type { GenerateResult } from '@/server/generate-rewrite'

/**
 * Server Action (8.4): genera la propuesta de reescritura de un pendiente.
 * Sin aprobación automática: la decisión se registra al Aceptar (8.5).
 */
export async function generateRewriteAction(
  path: string,
  templateName?: string,
): Promise<GenerateResult> {
  const res = await generateRewriteFor(path, templateName)
  if (!res.ok) revalidatePath('/pendientes')
  return res
}

/**
 * Server Action (8.5 ⚠️): Aceptar la propuesta — ÚNICO punto del bloque 8
 * que escribe. Orden (checkpoint 8.0/d):
 *   1. Guard de hash: el disco debe seguir igual que en la detección
 *      (row.hash = lo que se pasó al LLM). Si cambió → rechazo, cero escrituras.
 *   2. Archivar el ORIGINAL en .history/<relpath>/<ts>.md (recuperable).
 *   3. writeAtomic de la propuesta (atómico).
 *   4. pending_actions → 'approved' (la decisión humana queda registrada).
 */
export async function acceptRewriteAction(
  path: string,
  markdown: string,
): Promise<{ ok: boolean; error?: string; archivedTo?: string }> {
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    return { ok: false, error: 'Propuesta vacía' }
  }

  const root = getEnv().REPORTS_ROOT
  const row = getPendingAction(path)
  if (!row) return { ok: false, error: 'Ese reporte ya no está pendiente' }

  let absPath: string
  try {
    absPath = resolveSafe(path, root)
  } catch (err) {
    if (err instanceof PathEscapeError) return { ok: false, error: err.message }
    return { ok: false, error: 'El fichero ya no está en disco' }
  }

  let diskHash: string
  try {
    diskHash = sha256File(absPath)
  } catch {
    return { ok: false, error: 'El fichero ya no está en disco' }
  }
  if (diskHash !== row.hash) {
    return {
      ok: false,
      error:
        'El fichero cambió desde la detección (editado fuera, o la propuesta está caducada): ' +
        'genera la propuesta de nuevo. Nada se ha escrito.',
    }
  }

  const archived = saveHistoryCopy(path, root) // 8.5: original SIEMPRE recuperable
  writeAtomic(path, markdown, { root })
  // Escritura de la app (8.5): el watcher no debe re-detectar el fichero
  markOwnWrite(absPath, sha256Content(markdown))
  resolvePending(path, 'approved')

  revalidatePath('/pendientes')
  revalidatePath(`/proyectos/${encodeURIComponent(path.split('/')[0] ?? '')}`)
  notifyPendingCount()
  return { ok: true, archivedTo: archived ?? undefined }
}
