import { readFile } from 'node:fs/promises'
import { resolveSafe } from '@/core/fs/paths'
import { assertApproved, type RewriteExecutor } from '@/core/reports/rewrite'
import { getPendingAction } from '@/db/pending'
import { defaultDbPath } from '@/db/db'
import { getEnv } from '@/lib/env'

/**
 * Ejecuta la reescritura de un reporte pendiente (pegamento 6.4/6.5).
 *
 * Orden de puertas, de fuera hacia dentro:
 *   1. GUARD (6.5 ⚠️): la fila de pending_actions debe existir y estar
 *      'approved' — si no, NotApprovedError y el executor NUNCA se invoca.
 *   2. Extension point: sin executor (el LLM llega en el bloque 8) se
 *      devuelve ran:false con motivo; la aprobación queda registrada.
 *   3. Con executor: se le entrega path/content/hash leídos del disco.
 */
export async function runRewriteFor(
  relPath: string,
  executor?: RewriteExecutor,
  dbPath: string = defaultDbPath(),
): Promise<{ ran: boolean; reason?: string }> {
  const row = getPendingAction(relPath, dbPath)

  // ⚠️ 6.5: el guard va antes de TODO lo demás
  assertApproved(relPath, row?.status)

  if (!executor) {
    return { ran: false, reason: 'Reescritura con LLM aún no configurada (bloque 8)' }
  }

  const absPath = resolveSafe(relPath, getEnv().REPORTS_ROOT)
  const content = await readFile(absPath, 'utf8')
  await executor({ path: relPath, content, hash: row.hash })
  return { ran: true }
}
