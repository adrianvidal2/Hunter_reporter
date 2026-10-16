'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  createKbAction,
  deleteKbAction,
  listKbAction,
  loadKbEntryAction,
  readKbReferenceAction,
  updateKbAction,
  type KbCategory,
  type KbEntry,
  type KbIndexEntry,
} from '@/app/kb/actions'
import { groupKbEntries, UNTAGGED_KEY } from '@/core/kb/facet'

/**
 * Gestión CRUD de la KB (Tarea 6b), calcada del gestor de Prompts:
 * filtros por categoría/ámbito + selector de proyecto, editor de
 * SKILL.md (name/description/categoría/tags/cuerpo) y vista básica de
 * references/ (listar y leer; el contenido vive en disco).
 */

interface Editing {
  slug: string
  /** Ámbito REAL donde vive la entrada ('global' o el nombre del proyecto). */
  scope: string
  name: string
  description: string
  category: KbCategory
  tags: string
  body: string
  references: string[]
}

const CATEGORY_LABEL: Record<KbCategory, string> = {
  tecnica: 'técnica',
  reporte: 'reporte',
}

export function KbManager({ initial, projects }: { initial: KbIndexEntry[]; projects: string[] }) {
  const [items, setItems] = useState<KbIndexEntry[]>(initial)
  const [project, setProject] = useState<string>('') // '' = solo global
  const [categoryFilter, setCategoryFilter] = useState<'all' | KbCategory>('all')
  const [scopeFilter, setScopeFilter] = useState<'all' | 'global' | 'project'>('all')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<KbCategory>('tecnica')
  const [tags, setTags] = useState('')
  const [body, setBody] = useState('')
  const [createScope, setCreateScope] = useState<'global' | 'project'>('global')
  const [refView, setRefView] = useState<{ name: string; content: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  /** Índice desde el servidor para el ámbito seleccionado. */
  const reloadIndex = (proj: string) => {
    startTransition(async () => {
      const res = await listKbAction(proj || undefined)
      if (res.ok) setItems(res.data)
      else setError(res.error)
    })
  }

  const changeProject = (p: string) => {
    setProject(p)
    setEditing(null)
    setCreating(false)
    setRefView(null)
    reloadIndex(p)
  }

  const visible = useMemo(
    () =>
      items.filter(
        (e) =>
          (categoryFilter === 'all' || e.category === categoryFilter) &&
          (scopeFilter === 'all' || e.scope === scopeFilter),
      ),
    [items, categoryFilter, scopeFilter],
  )

  const [groupBy, setGroupBy] = useState<'none' | 'tag' | 'category'>('none')

  const grouped = useMemo(
    () => (groupBy === 'none' ? null : groupKbEntries(visible, { by: groupBy })),
    [visible, groupBy],
  )

  const reset = () => {
    setEditing(null)
    setCreating(false)
    setRefView(null)
    setName('')
    setDescription('')
    setCategory('tecnica')
    setTags('')
    setBody('')
    setError(null)
  }

  const startCreate = () => {
    setCreating(true)
    setEditing(null)
    setRefView(null)
    setName('')
    setDescription('')
    setCategory('tecnica')
    setTags('')
    setBody('')
    setCreateScope(project === '' ? 'global' : 'project')
    setError(null)
  }

  const startEdit = (e: KbIndexEntry) => {
    setError(null)
    setCreating(false)
    setRefView(null)
    startTransition(async () => {
      const res = await loadKbEntryAction(e.slug, e.scope === 'project' ? project : undefined)
      if (!res.ok) {
        setError(res.error)
        return
      }
      const entry: KbEntry = res.data
      setEditing({
        slug: entry.slug,
        scope: entry.scope === 'project' ? project : 'global',
        name: entry.name,
        description: entry.description,
        category: entry.category,
        tags: entry.tags.join(', '),
        body: entry.body,
        references: entry.references,
      })
      setName(entry.name)
      setDescription(entry.description)
      setCategory(entry.category)
      setTags(entry.tags.join(', '))
      setBody(entry.body)
    })
  }

  const save = () => {
    setError(null)
    const payload = {
      name,
      description,
      category,
      tags: tags.split(',').map((t) => t.trim()).filter((t) => t !== ''),
      body,
    }
    startTransition(async () => {
      const res = creating
        ? await createKbAction(payload, createScope === 'project' ? project : 'global')
        : await updateKbAction(editing!.slug, payload, editing!.scope)
      if (!res.ok) {
        setError(res.error ?? 'Error inesperado')
        return
      }
      reset()
      reloadIndex(project)
    })
  }

  const del = (e: KbIndexEntry) => {
    if (!window.confirm(`¿Borrar «${e.slug}»? Se moverá a .trash (recuperable).`)) return
    setError(null)
    startTransition(async () => {
      const res = await deleteKbAction(e.slug, e.scope === 'project' ? project : 'global')
      if (!res.ok) {
        setError(res.error ?? 'Error inesperado')
        return
      }
      reloadIndex(project)
    })
  }

  const viewRef = (refName: string) => {
    setError(null)
    const slug = editing?.slug ?? ''
    startTransition(async () => {
      const res = await readKbReferenceAction(slug, refName, project || undefined)
      if (!res.ok) {
        setError(res.error ?? 'Error inesperado')
        return
      }
      setRefView(res.data)
    })
  }

  const entryRow = (e: KbIndexEntry) => (
    <li key={`${e.scope}-${e.slug}`} className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {e.name}{' '}
          <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] ${e.category === 'reporte' ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400'}`}>
            {CATEGORY_LABEL[e.category]}
          </span>{' '}
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${e.scope === 'project' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400'}`}>
            {e.scope === 'project' ? `proyecto: ${project}` : 'global'}
          </span>
        </p>
        <p className="font-mono text-xs text-zinc-400">{e.slug}</p>
        {e.description !== '' ? (
          <p className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{e.description}</p>
        ) : null}
        {e.tags.length > 0 ? (
          <p className="mt-1 font-mono text-[10px] text-zinc-400">#{e.tags.join(' #')}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => startEdit(e)}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Editar
        </button>
        <button
          type="button"
          onClick={() => del(e)}
          className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
        >
          Borrar
        </button>
      </div>
    </li>
  )

  return (
    <div>
      {/* Filtros: ámbito (proyecto), categoría y scope resuelto */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        <label className="block text-sm">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Ámbito</span>
          <select
            value={project}
            onChange={(e) => changeProject(e.target.value)}
            aria-label="Ámbito de la KB"
            className="mt-1 block rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:[color-scheme:dark]"
          >
            <option value="">Solo global</option>
            {projects.map((p) => (
              <option key={p} value={p}>Proyecto: {p}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Categoría</span>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | KbCategory)}
            aria-label="Filtrar por categoría"
            className="mt-1 block rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:[color-scheme:dark]"
          >
            <option value="all">todas</option>
            <option value="tecnica">técnica</option>
            <option value="reporte">reporte</option>
          </select>
        </label>
        {project !== '' ? (
          <label className="block text-sm">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Origen</span>
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value as 'all' | 'global' | 'project')}
              aria-label="Filtrar por origen"
              className="mt-1 block rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:[color-scheme:dark]"
            >
              <option value="all">todos</option>
              <option value="global">global</option>
              <option value="project">proyecto</option>
            </select>
          </label>
        ) : null}
        <label className="block text-sm">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Agrupar por</span>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as 'none' | 'tag' | 'category')}
            aria-label="Agrupar entradas"
            className="mt-1 block rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:[color-scheme:dark]"
          >
            <option value="none">sin agrupar</option>
            <option value="tag">tag</option>
            <option value="category">categoría</option>
          </select>
        </label>
        <div className="grow" />
        <button
          type="button"
          onClick={startCreate}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          + Nueva entrada
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {/* Formulario crear/editar */}
      {creating || editing ? (
        <div className="mt-4 space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {creating ? 'Nueva entrada' : `Editar: ${editing!.slug}`}
              {editing ? (
                <span className="ml-2 rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  {editing.scope === 'global' ? 'global' : `proyecto: ${editing.scope}`}
                </span>
              ) : null}
            </h3>
            <button type="button" onClick={reset} className="text-sm text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
              Cancelar
            </button>
          </div>

          <label className="block text-sm">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Nombre (lowercase-hyphen; de aquí sale el slug)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 font-mono text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              autoFocus
            />
          </label>

          <label className="block text-sm">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Descripción (qué es + CUÁNDO usarla)</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <label className="block text-sm">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Categoría</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as KbCategory)}
                aria-label="Categoría de la entrada"
                className="mt-1 block rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:[color-scheme:dark]"
              >
                <option value="tecnica">técnica</option>
                <option value="reporte">reporte</option>
              </select>
            </label>
            <label className="block grow text-sm">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Tags (separados por coma)</span>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
            </label>
            {creating ? (
              <label className="block text-sm">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Crear en</span>
                <select
                  value={createScope}
                  onChange={(e) => setCreateScope(e.target.value as 'global' | 'project')}
                  aria-label="Ámbito de creación"
                  className="mt-1 block rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:[color-scheme:dark]"
                >
                  <option value="global">global</option>
                  {project !== '' ? <option value="project">proyecto: {project}</option> : null}
                </select>
              </label>
            ) : null}
          </div>

          <label className="block text-sm">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Cuerpo (markdown, lean)</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 font-mono text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:[color-scheme:dark]"
            />
          </label>

          {/* References: gestión básica (listar y leer; viven en disco) */}
          {editing && editing.references.length > 0 ? (
            <div className="text-sm">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">References (ficheros en &lt;slug&gt;/references/)</span>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {editing.references.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => viewRef(r)}
                    className="rounded-md border border-zinc-300 px-2 py-0.5 font-mono text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    {r}
                  </button>
                ))}
              </div>
              {refView ? (
                <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-zinc-950 p-3 font-mono text-xs text-zinc-100">{refView.content}</pre>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending || name.trim() === ''}
              className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {pending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      ) : null}

      {/* Lista (plana o agrupada por tag/categoría, Tarea 11) */}
      {visible.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
          Sin entradas para este filtro.
        </p>
      ) : grouped ? (
        <div className="mt-4 space-y-5">
          {grouped.map((g) => (
            <div key={g.key}>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {g.key === UNTAGGED_KEY ? '(sin etiqueta)' : g.key}{' '}
                <span className="text-zinc-400">({g.entries.length})</span>
              </h4>
              <ul className="mt-1.5 divide-y divide-zinc-200 dark:divide-zinc-800">
                {g.entries.map((e) => entryRow(e))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
          {visible.map((e) => entryRow(e))}
        </ul>
      )}
    </div>
  )
}
