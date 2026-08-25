import { NewProjectForm } from '@/components/new-project-form'
import { ProjectCard } from '@/components/project-card'
import { listProject, listProjects } from '@/core/fs/tree'
import { getEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

export default async function ProyectosPage() {
  const root = getEnv().REPORTS_ROOT
  const projects = listProjects(root).map((name) => ({ name, ...listProject(name, root) }))

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Proyectos</h1>
      <NewProjectForm />

      {projects.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
          No hay proyectos en <code className="font-mono">{root}</code>.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.name} project={p.name} listing={p} />
          ))}
        </div>
      )}
    </div>
  )
}
