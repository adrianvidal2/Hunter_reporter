'use client'

import { useState } from 'react'
import { IntigritiProgramsTab } from './intigriti-programs-tab'
import { YwhProgramsTab } from './ywh-programs-tab'

/**
 * Pestaña Programas (paso 4): dos subpestanas por plataforma. En el sidebar
 * sigue habiendo UNA sola entrada (Programas).
 *
 * Cada subpestana es independiente y perezosa: su contenido no se monta
 * hasta que el usuario la pulsa por primera vez (ahí es cuando cada una
 * carga sus datos, y de ahí en adelante cada una conserva su estado).
 */

type PlatformTab = 'ywh' | 'intigriti'

const TAB_LABELS: { id: PlatformTab; label: string }[] = [
  { id: 'ywh', label: 'YesWeHack' },
  { id: 'intigriti', label: 'Intigriti' },
]

export function ProgramasTabs({ localProjects }: { localProjects: string[] }) {
  const [active, setActive] = useState<PlatformTab | null>(null)
  const [mounted, setMounted] = useState<Set<PlatformTab>>(new Set())

  const open = (tab: PlatformTab) => {
    setActive(tab)
    setMounted((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)))
  }

  const tabClass = (tab: PlatformTab) =>
    `rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
      active === tab
        ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
        : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
    }`

  return (
    <div className="mt-4">
      <div role="tablist" aria-label="Plataforma" className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TAB_LABELS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active === id}
            onClick={() => open(id)}
            className={tabClass(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {active === null ? (
        <p className="mt-6 rounded-md border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          Elige una plataforma para cargar sus programas.
        </p>
      ) : null}

      {/* Montadas bajo demanda al primer clic; luego se conservan vivas (hidden) */}
      {mounted.has('ywh') ? (
        <div role="tabpanel" aria-label="Programas de YesWeHack" className={active === 'ywh' ? '' : 'hidden'}>
          <YwhProgramsTab localProjects={localProjects} />
        </div>
      ) : null}
      {mounted.has('intigriti') ? (
        <div role="tabpanel" aria-label="Programas de Intigriti" className={active === 'intigriti' ? '' : 'hidden'}>
          <IntigritiProgramsTab localProjects={localProjects} />
        </div>
      ) : null}
    </div>
  )
}
