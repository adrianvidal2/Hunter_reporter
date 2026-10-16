import { KbManager } from '@/components/kb-manager'
import { listKbIndex } from '@/core/kb/kb'
import { listProjects } from '@/core/fs/tree'
import { getEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * Página «Conocimiento» (Tarea 6b): CRUD de la KB estilo Agent Skills en
 * dos ámbitos (global / proyecto). El índice carga server-side; el gestor
 * cliente refina por categoría/ámbito y edita.
 */
export default async function KbPage() {
  const root = getEnv().REPORTS_ROOT
  const projects = listProjects(root)
  const entries = listKbIndex({ root })

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Conocimiento</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Base de conocimiento estilo Agent Skills para agentes y reportes ({entries.length} entradas
        globales). Se guarda como <code className="font-mono">&lt;slug&gt;/SKILL.md</code> en{' '}
        <code className="font-mono">.config/kb/</code> (global) o{' '}
        <code className="font-mono">&lt;proyecto&gt;/.config/kb/</code>; el proyecto siempre gana
        sobre lo global.
      </p>
      <div className="mt-4 max-w-4xl">
        <KbManager initial={entries} projects={projects} />
      </div>
    </div>
  )
}
