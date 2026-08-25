import { notFound } from 'next/navigation'
import { ProjectTabs } from '@/components/project-tabs'
import { listProject, listProjects } from '@/core/fs/tree'
import { readProjectProgram } from '@/core/ywh/program-file'
import { listPrompts } from '@/core/prompts/prompts'
import { getEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

export default async function ProyectoDetallePage({
  params,
}: PageProps<'/proyectos/[project]'>) {
  const { project } = await params
  const root = getEnv().REPORTS_ROOT

  // Solo proyectos reales: evita rutas raras y da un 404 limpio
  if (!listProjects(root).includes(project)) notFound()

  const listing = listProject(project, root)
  // Pestaña Programa: lee `<proyecto>/programa.json` (null si no existe).
  const program = readProjectProgram(project, root)
  // Prompts globales para el PASO 2 del wizard Lanzar (reutiliza el loader).
  const prompts = listPrompts(root)
  return (
    <ProjectTabs
      listing={listing}
      projects={listProjects(root)}
      program={program}
      prompts={prompts}
    />
  )
}
