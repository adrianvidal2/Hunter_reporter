'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { getProgramAction } from '@/app/programas/actions'
import type { Program, ShortProgram } from '@/core/ywh/types'
import { ProgramDetail } from './program-detail'
import { listProjects } from '@/core/fs/tree'

/**
 * Explorador de programas YWH (9.5): maestro (lista con filtros) / detalle
 * bajo demanda. Diseño propio coherente con el resto de la app.
 */

type TypeFilter = 'all' | 'bug-bounty' | 'vdp-in-app'
type VisibilityFilter = 'all' | 'public' | 'private'

export function ProgramasExplorer({
  programs,
  hasToken,
  localProjects = [],
}: {
  programs: ShortProgram[]
  hasToken: boolean
  localProjects?: string[]
}) {
  const [query, setQuery] = useState('')
  const [typeF, setTypeF] = useState<TypeFilter>('all')
  const [visF, setVisF] = useState<VisibilityFilter>('all')
  const [bountyOnly, setBountyOnly] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return programs.filter((p) => {
      if (typeF !== 'all' && p.type !== typeF) return false
      if (visF === 'public' && !p.public) return false
      if (visF === 'private' && p.public) return false
      if (bountyOnly && !p.bounty) return false
      if (q) {
        const hay = `${p.title} ${p.slug} ${p.business_unit?.name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [programs, query, typeF, visF, bountyOnly])

  // Detalle bajo demanda (con caché en memoria de sesión)
  const [detail, setDetail] = useState<Program | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cache = useRef(new Map<string, Program>())
  const existing = useRef(new Set<string>())

  useEffect(() => {
    // proyectos locales ya creados (para el estado inicial del botón 9.6)
    for (const p of localProjects) existing.current.add(p)
  }, [localProjects])

  useEffect(() => {
    if (selected === null) return
    const cached = cache.current.get(selected)
    if (cached) {
      setDetail(cached)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setDetail(null)
    void getProgramAction(selected).then((res) => {
      if (cancelled) return
      setLoading(false)
      if (res.ok) {
        cache.current.set(selected, res.program)
        setDetail(res.program)
      } else {
        setError(res.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [selected])

  const selectClass =
    'rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:[color-scheme:dark]'

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre, slug o empresa…"
          aria-label="Buscar programas"
          className="w-64 rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700"
        />
        <select value={typeF} onChange={(e) => setTypeF(e.target.value as TypeFilter)} aria-label="Filtrar por tipo" className={selectClass}>
          <option value="all">Todos los tipos</option>
          <option value="bug-bounty">Bug bounty</option>
          <option value="vdp-in-app">VDP</option>
        </select>
        <select value={visF} onChange={(e) => setVisF(e.target.value as VisibilityFilter)} aria-label="Filtrar por visibilidad" className={selectClass}>
          <option value="all">Públicos y privados</option>
          <option value="public">Solo públicos</option>
          <option value="private">Solo privados</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
          <input type="checkbox" checked={bountyOnly} onChange={(e) => setBountyOnly(e.target.checked)} />
          con bounty
        </label>
        <span className="text-xs text-zinc-400 tabular-nums dark:text-zinc-500">
          {filtered.length}/{programs.length}
          {!hasToken ? ' · sin token: solo públicos' : ''}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,400px)_1fr]">
        {/* Maestro */}
        <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
              Ningún programa coincide con los filtros.
            </li>
          ) : (
            filtered.map((p) => (
              <li key={p.slug}>
                <button
                  type="button"
                  onClick={() => setSelected(p.slug)}
                  aria-current={selected === p.slug ? 'true' : undefined}
                  className={`block w-full px-3 py-2.5 text-left transition-colors ${
                    selected === p.slug
                      ? 'bg-zinc-100 dark:bg-zinc-900'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">{p.title || p.slug}</span>
                    {!p.public ? (
                      <span className="shrink-0 rounded-full border border-amber-300 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-700 dark:text-amber-300">
                        privado
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="min-w-0 truncate font-mono">{p.slug}</span>
                    <span className="shrink-0 tabular-nums">
                      {p.scopes_count} scopes{p.bounty ? ` · ${p.bounty_reward_min}–${p.bounty_reward_max}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>

        {/* Detalle */}
        <div className="min-w-0">
          {selected === null ? (
            <p className="rounded-md border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              Selecciona un programa para ver su scope, UA y reward grid.
            </p>
          ) : loading ? (
            <p className="px-2 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
              Cargando detalle de <code className="font-mono">{selected}</code>…
            </p>
          ) : error ? (
            <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          ) : detail ? (
            <ProgramDetail program={detail} existingProject={existing.current.has(detail.slug) ? detail.slug : undefined} />
          ) : null}
        </div>
      </div>
    </div>
  )
}
