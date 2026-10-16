import { ReconNewsPanel } from '@/components/recon-news-panel'
import { listProjects } from '@/core/fs/tree'
import { getEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * Página «Novedades» (Tarea 9c): monitorización continua de recon pasivo —
 * estado del scheduler (opt-in por proyecto), novedades (assets nuevos) y
 * avisos por SSE. El scheduler SOLO lanza etapas passive/light: lo activo
 * sigue con clic humano.
 */
export default async function NovedadesPage() {
  const projects = listProjects(getEnv().REPORTS_ROOT)

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Novedades</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Monitorización continua: recon <strong>pasivo/ligero</strong> en intervalo por proyecto
        (opt-in) → diff → assets nuevos. Lo activo/explotación JAMÁS se auto-lanza: sigue con clic
        humano.
      </p>
      <div className="mt-4 max-w-4xl">
        <ReconNewsPanel projects={projects} />
      </div>
    </div>
  )
}
