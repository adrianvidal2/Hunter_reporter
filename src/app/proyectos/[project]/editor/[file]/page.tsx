import { readFile, stat } from 'node:fs/promises'
import { notFound } from 'next/navigation'
import { MarkdownEditorLazy } from '@/components/markdown-editor-lazy'
import { resolveSafe } from '@/core/fs/paths'
import { listProject, listProjects } from '@/core/fs/tree'
import { getEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * Editor de borrador: /proyectos/[project]/editor/[file]
 * El .md se valida contra listProject (debe estar en reportes/) y su
 * contenido se lee por el servidor y se pasa como contenido inicial.
 */
export default async function MarkdownEditorPage({
  params,
}: PageProps<'/proyectos/[project]/editor/[file]'>) {
  const { project, file } = await params
  const root = getEnv().REPORTS_ROOT

  if (!listProjects(root).includes(project)) notFound()

  const entry = listProject(project, root).drafts.find((f) => f.name === file)
  if (!entry) notFound()

  const content = await readFile(resolveSafe(entry.relPath, root), 'utf8')
  const { mtimeMs } = await stat(resolveSafe(entry.relPath, root))

  return (
    <MarkdownEditorLazy
      fileName={entry.name}
      relPath={entry.relPath}
      initialContent={content}
      initialMtimeMs={Math.round(mtimeMs)}
    />
  )
}
