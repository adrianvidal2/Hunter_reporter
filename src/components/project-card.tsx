'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { deleteProjectAction } from '@/app/actions'
import type { ProjectListing } from '@/core/fs/tree'

/**
 * Tarjeta de proyecto en el dashboard, con acción de ELIMINAR.
 * - Elimina SOLO el proyecto donde se pulsa (pasa su nombre al server).
 * - Confirmación obligatoria que muestra el NOMBRE exacto del proyecto.
 * - Mueve la carpeta entera a .trash/ (recuperable), no unlink.
 */

export function ProjectCard({ project, listing }: { project: string; listing: ProjectListing }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const openRef = useRef<HTMLButtonElement>(null)

  const remove = async () => {
    // Confirmación obligatoria con el nombre visible, para no equivocarse.
    const ok = window.confirm(
      `¿Eliminar el proyecto «${project}»?\n\nSe moverá entero a .trash/ y desaparecerá de la lista. Esta acción no se puede deshacer desde la UI.`,
    )
    if (!ok) return
    setError(null)
    setPending(true)
    const res = await deleteProjectAction(project)
    setPending(false)
    if (res.ok) {
      router.refresh()
    } else {
      setError(res.error ?? 'No se pudo eliminar')
      openRef.current?.focus() // devolver foco al botón para re-leer la acción
    }
  }

  return (
    <div className="relative rounded-lg border border-zinc-200 bg-white p-5 transition-colors dark:border-zinc-800 dark:bg-zinc-950">
      <Link
        href={`/proyectos/${encodeURIComponent(project)}`}
        className="block transition-colors hover:text-zinc-700 dark:hover:text-zinc-200"
      >
        <h2 className="truncate font-medium">{project}</h2>
        <dl className="mt-4 flex gap-6 text-sm">
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Entregados</dt>
            <dd className="mt-0.5 text-xl font-semibold tabular-nums">
              {listing.delivered.length}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Borradores</dt>
            <dd className="mt-0.5 text-xl font-semibold tabular-nums">{listing.drafts.length}</dd>
          </div>
        </dl>
      </Link>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      <button
        ref={openRef}
        type="button"
        onClick={() => void remove()}
        disabled={pending}
        aria-label={`Eliminar proyecto ${project}`}
        title="Eliminar proyecto (se mueve a .trash/)"
        className="absolute right-3 top-3 rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950 dark:hover:text-red-400"
      >
        {pending ? '…' : '✕'}
      </button>
    </div>
  )
}