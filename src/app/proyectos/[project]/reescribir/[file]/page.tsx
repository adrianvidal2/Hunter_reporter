import { readFile } from 'node:fs/promises'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MarkdownPreview } from '@/components/markdown-preview'
import { RewriteReview } from '@/components/rewrite-review'
import { PathEscapeError, resolveSafe } from '@/core/fs/paths'
import { listProject, listProjects } from '@/core/fs/tree'
import {
  DEFAULT_TEMPLATE_NAME,
  ensureDefaultTemplate,
  findTemplate,
  listTemplateOptions,
} from '@/core/reports/templates'
import { getEnv } from '@/lib/env'
import { generateDraftRewriteAction } from './actions'

export const dynamic = 'force-dynamic'

/**
 * Reescribir un borrador (10.1): vista de revisión del 8.4 con selector de
 * plantilla. La aprobación es el clic del usuario (fila 'approved' con hash
 * actual); Aceptar/Descartar se comportan igual que desde Pendientes.
 */
export default async function ReescribirBorradorPage({
  params,
}: PageProps<'/proyectos/[project]/reescribir/[file]'>) {
  const { project, file } = await params
  const root = getEnv().REPORTS_ROOT

  if (!listProjects(root).includes(project)) notFound()
  const entry = listProject(project, root).drafts.find((f) => f.name === file)
  if (!entry) notFound()

  let original: string
  try {
    original = await readFile(resolveSafe(entry.relPath, root), 'utf8')
  } catch (err) {
    if (err instanceof PathEscapeError) notFound()
    throw err
  }

  ensureDefaultTemplate(root)
  const templates = listTemplateOptions(project, root)
  const preferred = findTemplate(DEFAULT_TEMPLATE_NAME, { project, root })?.name
  const preselected = templates.find((t) => t.name === preferred)?.name ?? templates[0]?.name

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="min-w-0 truncate font-mono text-lg font-medium">{file}</h1>
        <Link
          href={`/proyectos/${encodeURIComponent(project)}`}
          className="shrink-0 text-sm underline"
        >
          ← volver a {project}
        </Link>
      </div>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Reescritura manual: al generar, tu acción queda registrada como aprobación explícita
        (guard 6.5 intacto). Aceptar archiva el original en <code>.history/</code>; Descartar no
        toca el fichero.
      </p>

      <details className="mt-3 rounded-md border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Original</summary>
        <div className="markdown-preview-frame max-h-96 overflow-auto px-4 pb-4">
          <MarkdownPreview markdown={original} />
        </div>
      </details>

      <RewriteReview
        path={entry.relPath}
        templates={templates}
        preselectedTemplate={preselected}
        generate={generateDraftRewriteAction}
      />
    </div>
  )
}
