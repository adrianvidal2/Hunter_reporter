'use client'

import { useState, useTransition } from 'react'
import {
  createPromptAction,
  deletePromptAction,
  updatePromptAction,
} from '@/app/prompts/actions'
import type { PromptMeta } from '@/core/prompts/prompts'

/**
 * Gestión CRUD de prompts globales (.config/prompts).
 * Lista, crea, edita (nombre + texto) y borra con confirmación.
 */

type Editing = { slug: string; name: string; content: string } | null

export function PromptsManager({ initial }: { initial: PromptMeta[] }) {
  const [items, setItems] = useState<PromptMeta[]>(initial)
  const [editing, setEditing] = useState<Editing>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const reset = () => {
    setEditing(null)
    setCreating(false)
    setName('')
    setContent('')
    setError(null)
  }

  const run = (fn: () => Promise<{ ok: boolean; error?: string; data?: PromptMeta | { deleted: boolean } }>) => {
    setError(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) {
        setError(res.error ?? 'Error inesperado')
        return
      }
      // refrescar la lista local con el estado devuelto
      const updated = res.data as PromptMeta
      if (editing) {
        setItems((prev) => prev.map((p) => (p.slug === editing.slug ? updated : p)))
      } else if (creating) {
        setItems((prev) => [...prev, updated])
      }
      reset()
    })
  }

  const saveNew = () => run(() => createPromptAction(name, content))
  const saveEdit = () =>
    run(() => updatePromptAction(editing!.slug, { name, content }))
  const del = (slug: string) => {
    if (!window.confirm('¿Borrar este prompt? Se moverá a .trash (recuperable).')) return
    setError(null)
    startTransition(async () => {
      const res = await deletePromptAction(slug)
      if (!res.ok) {
        setError(res.error ?? 'Error inesperado')
        return
      }
      setItems((prev) => prev.filter((p) => p.slug !== slug))
    })
  }

  const startEdit = (p: PromptMeta) => {
    setEditing({ slug: p.slug, name: p.name, content: p.content })
    setCreating(false)
    setName(p.name)
    setContent(p.content)
    setError(null)
  }
  const startCreate = () => {
    setCreating(true)
    setEditing(null)
    setName('')
    setContent('')
    setError(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Prompts</h2>
        <button
          type="button"
          onClick={startCreate}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          + Nuevo prompt
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {/* Formulario crear/editar */}
      {(creating || editing) ? (
        <div className="mt-4 space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-700">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{creating ? 'Nuevo prompt' : `Editar: ${editing!.slug}`}</h3>
            <button type="button" onClick={reset} className="text-sm text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">Cancelar</button>
          </div>
          <label className="block text-sm">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Nombre</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              autoFocus
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Texto del prompt</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 font-mono text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:[color-scheme:dark]"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={creating ? saveNew : saveEdit}
              disabled={pending || name.trim() === ''}
              className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {pending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      ) : null}

      {/* Lista */}
      {items.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">Sin prompts todavía.</p>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
          {items.map((p) => (
            <li key={p.slug} className="flex items-start justify-between gap-4 py-2.5">
              <div className="min-w-0">
                <p className="font-medium text-sm">{p.name}</p>
                <p className="font-mono text-xs text-zinc-400">{p.slug}.md</p>
                {p.content ? (
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{p.content}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(p)}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => del(p.slug)}
                  className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                >
                  Borrar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
