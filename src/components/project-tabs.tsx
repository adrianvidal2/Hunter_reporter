'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { deleteFileAction, moveFileAction } from '@/app/actions'
import type { ProjectListing } from '@/core/fs/tree'
import type { Program } from '@/core/ywh/types'
import type { PromptMeta } from '@/core/prompts/prompts'
import { filterFiles, sortFiles, type SortBy, type SortDir } from '@/core/fs/sorting'
import { defaultProjectTab, PROJECT_TAB_ORDER, type ProjectTab } from '@/core/project-tabs'
import { ProjectProgramTab } from './project-program-tab'

/** Formatea bytes a la unidad más legible. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('es', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'name', label: 'Nombre' },
  { value: 'date', label: 'Fecha' },
  { value: 'size', label: 'Tamaño' },
]

const DIR_LABEL: Record<SortDir, string> = { asc: '↑', desc: '↓' }

type Tab = ProjectTab

export function ProjectTabs({
  listing,
  projects,
  program = null,
  prompts = [],
}: {
  listing: ProjectListing
  /** Todos los proyectos (para el menú "Mover a…" del 3.5). */
  projects: string[]
  /** Programa local (pestaña “Programa”, solo lectura). */
  program?: Program | null
  /** Prompts globales para el wizard Lanzar (paso 2). */
  prompts?: PromptMeta[]
}) {
  const [tab, setTab] = useState<Tab>(defaultProjectTab())
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const base = tab === 'entregados' ? listing.delivered : listing.drafts
  const files = useMemo(
    () => sortFiles(filterFiles(base, query), sortBy, sortDir),
    [base, query, sortBy, sortDir],
  )

  const otherProjects = projects.filter((p) => p !== listing.project)

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setActionError(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) setActionError(res.error ?? 'Error inesperado')
    })
  }

  const move = (relPath: string, target: string) => {
    setMenuFor(null)
    run(() => moveFileAction(relPath, target))
  }

  const remove = (relPath: string) => {
    setMenuFor(null)
    run(() => deleteFileAction(relPath))
  }

  const tabButton = (value: Tab, label: string, count: number) => (
    <button
      key={value}
      type="button"
      onClick={() => setTab(value)}
      aria-current={tab === value ? 'true' : undefined}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        tab === value
          ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
          : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
      }`}
    >
      {label}
      <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs tabular-nums dark:bg-zinc-800">
        {count}
      </span>
    </button>
  )

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{listing.project}</h1>

      <div className="mt-4 flex gap-2 border-b border-zinc-200 dark:border-zinc-800" role="tablist">
        {PROJECT_TAB_ORDER.map((value) => {
          const counts: Record<Tab, number> = {
            programa: program != null ? 1 : 0,
            entregados: listing.delivered.length,
            borradores: listing.drafts.length,
          }
          const labels: Record<Tab, string> = {
            programa: 'Programa',
            entregados: 'Entregados',
            borradores: 'Borradores',
          }
          return tabButton(value, labels[value], counts[value])
        })}
      </div>

      {tab === 'programa' ? (
        <div className="mt-6">
          <ProjectProgramTab program={program} project={listing.project} prompts={prompts} />
        </div>
      ) : (
        <>
        <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre…"
          aria-label="Buscar por nombre"
          className="w-56 rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700"
        />
        <label className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
          Ordenar por
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:[color-scheme:dark]"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          aria-label={`Orden ${sortDir === 'asc' ? 'ascendente' : 'descendente'}`}
          title={`Orden ${sortDir === 'asc' ? 'ascendente' : 'descendente'}`}
          className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700"
        >
          {DIR_LABEL[sortDir]}
        </button>
        <span className="text-xs text-zinc-400 tabular-nums dark:text-zinc-500">
          {files.length}/{base.length}
        </span>
      </div>

      {actionError ? (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {actionError}
        </p>
      ) : null}
      {pending ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">Trabajando…</p>
      ) : null}

      {files.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
          {query ? `Nada coincide con «${query}».` : 'Sin ficheros todavía.'}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
          {files.map((f) => (
            <li key={f.relPath} className="flex items-center justify-between gap-4 py-2.5">
              <span className="min-w-0 flex-1 truncate font-mono text-sm">
                {tab === 'entregados' ? (
                  <Link
                    href={`/proyectos/${encodeURIComponent(listing.project)}/pdf/${encodeURIComponent(f.name)}`}
                    className="hover:underline"
                  >
                    {f.name}
                  </Link>
                ) : (
                  <Link
                    href={`/proyectos/${encodeURIComponent(listing.project)}/editor/${encodeURIComponent(f.name)}`}
                    className="hover:underline"
                  >
                    {f.name}
                  </Link>
                )}
              </span>
              <span className="shrink-0 text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                {formatBytes(f.size)} · {formatDate(f.mtimeMs)}
              </span>
              {tab === 'borradores' ? (
                <Link
                  href={`/proyectos/${encodeURIComponent(listing.project)}/reescribir/${encodeURIComponent(f.name)}`}
                  title="Reescribir con LLM (eligiendo plantilla)"
                  className="shrink-0 rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  Reescribir
                </Link>
              ) : null}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setMenuFor(menuFor === f.relPath ? null : f.relPath)}
                  aria-label={`Acciones para ${f.name}`}
                  aria-expanded={menuFor === f.relPath}
                  className="rounded-md px-2 py-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                >
                  ⋯
                </button>
                {menuFor === f.relPath ? (
                  <div className="absolute right-0 top-8 z-10 w-52 rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
                    <p className="px-3 py-1 text-xs text-zinc-400">Mover a…</p>
                    {otherProjects.length === 0 ? (
                      <p className="px-3 py-1 text-xs text-zinc-400">No hay otros proyectos</p>
                    ) : (
                      otherProjects.map((p) => (
                        <button
                          key={p}
                          type="button"
                          disabled={pending}
                          onClick={() => move(f.relPath, p)}
                          className="block w-full truncate px-3 py-1.5 text-left hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-900"
                        >
                          {p}
                        </button>
                      ))
                    )}
                    <div className="my-1 border-t border-zinc-200 dark:border-zinc-700" />
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => remove(f.relPath)}
                      className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      Eliminar
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      </>
      )}
    </div>
  )
}
