import { readFile } from 'node:fs/promises'
import { PendientesPanel, type PendingItem } from '@/components/pendientes-panel'
import { PathEscapeError, resolveSafe } from '@/core/fs/paths'
import { listPending } from '@/db/pending'
import { getEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * Pendientes (6.3/6.4): reportes detectados por el watcher a la espera de
 * decisión humana. Sin aprobación no se ejecuta nada (6.5).
 */
export default async function PendientesPage() {
  const root = getEnv().REPORTS_ROOT

  const items: PendingItem[] = await Promise.all(
    listPending().map(async (row): Promise<PendingItem> => {
      let content: string | null = null
      try {
        content = await readFile(resolveSafe(row.path, root), 'utf8')
      } catch (err) {
        if (!(err instanceof PathEscapeError)) {
          // fichero movido/borrado tras la detección: se muestra sin preview
          content = null
        }
      }
      return {
        path: row.path,
        size: row.size,
        detectedAtMs: row.detectedAt.getTime(),
        content,
      }
    }),
  )

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Pendientes</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Reportes nuevos detectados en el árbol. Reescribir requiere tu aprobación explícita.
      </p>
      <div className="mt-4">
        <PendientesPanel items={items} />
      </div>
    </div>
  )
}
