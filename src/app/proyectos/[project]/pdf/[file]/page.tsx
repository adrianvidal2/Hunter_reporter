import { notFound } from 'next/navigation'
import { PdfViewerLazy } from '@/components/pdf-viewer-lazy'
import { listProject, listProjects } from '@/core/fs/tree'
import { getEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * Visor de PDF entregado: /proyectos/[project]/pdf/[file]
 * El fichero se valida contra listProject (debe estar en REPORTES_YWH/),
 * así que la página solo acepta rutas que la app conoce.
 */
export default async function PdfViewerPage({
  params,
}: PageProps<'/proyectos/[project]/pdf/[file]'>) {
  const { project, file } = await params
  const root = getEnv().REPORTS_ROOT

  if (!listProjects(root).includes(project)) notFound()

  const entry = listProject(project, root).delivered.find((f) => f.name === file)
  if (!entry) notFound()

  return <PdfViewerLazy relPath={entry.relPath} fileName={entry.name} />
}
