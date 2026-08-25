'use client'

import { useActionState, useEffect, useRef } from 'react'
import { createProjectAction, type CreateProjectState } from '@/app/actions'

const INITIAL: CreateProjectState = { ok: false }

export function NewProjectForm() {
  const [state, formAction, pending] = useActionState(createProjectAction, INITIAL)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state.ok) inputRef.current?.focus()
  }, [state])

  return (
    <form action={formAction} className="mt-6 flex flex-wrap items-start gap-2">
      <div>
        <input
          ref={inputRef}
          type="text"
          name="name"
          required
          placeholder="nombre-del-proyecto"
          aria-label="Nombre del nuevo proyecto"
          className="w-64 rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700"
        />
        {state.error ? (
          <p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
            {state.error}
          </p>
        ) : null}
        {state.ok && state.created ? (
          <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            Proyecto «{state.created}» creado.
          </p>
        ) : null}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pending ? 'Creando…' : 'Nuevo proyecto'}
      </button>
    </form>
  )
}
