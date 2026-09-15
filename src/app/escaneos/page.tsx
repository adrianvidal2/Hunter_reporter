import { ScansTable } from '@/components/scans-table'
import { buildScansView } from '@/server/scans'
import { getEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

/** Escaneos: lanzamientos de Orca (persistente launches.json) + estado EN
 *  VIVO consultado al abrir (terminal list), nunca cacheado. */
export default async function EscaneosPage() {
  const view = await buildScansView(getEnv().REPORTS_ROOT)
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Escaneos</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Lanzamientos de Orca por proyecto. El estado es EN VIVO (se consulta al abrir y con «Actualizar»): «Activa» solo es cierto en el momento de preguntar.
      </p>
      <div className="mt-4 max-w-6xl">
        <ScansTable initial={view.rows} liveError={view.liveError} />
      </div>
    </div>
  )
}
