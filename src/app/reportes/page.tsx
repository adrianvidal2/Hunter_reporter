import { ReportsList } from '@/components/reports-list'
import { readReportsCache } from '@/server/reports-cache'
import { readColumnWidths } from '@/server/reports-columns'

import type { ReportSortKey } from '@/core/ywh/reports'

export const dynamic = 'force-dynamic'

/** Ventana global "Reportes": lista de tus reportes de YesWeHack (SÓLO
 *  LECTURA, siempre pintada desde la cache; "Actualizar" hace la llamada
 *  en vivo). Las columnas son redimensionables; sus anchos se persisten en
 *  `.config/reports-columns.json`. */
export default async function ReportesPage() {
  const cache = readReportsCache()
  const columnWidths = readColumnWidths() ?? undefined
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Reportes</h1>
      <div className="mt-4">
        <ReportsList
          initialItems={cache?.items ?? []}
          cachedAt={cache?.savedAt ?? null}
          initialWidths={columnWidths as Partial<Record<ReportSortKey, number>> | undefined}
        />
      </div>
    </div>
  )
}
