'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { getIntigritiProgramAction, getIntigritiProgramsAction } from '@/app/programas/actions'
import type { NeutralProgramDetail, NeutralProgramSummary } from '@/core/programs/types'
import { ProgramDetail } from './program-detail'

/**
 * Subpestana Intigriti (paso 4). INDEPENDIENTE de la de YesWeHack: carga
 * SU lista al pulsarse, con su propia búsqueda y sus propios filtros.
 *
 * Sin PAT configurado NO sale vacía: muestra que hace falta un token con
 * enlace a Ajustes (la API de Intigriti no tiene endpoints públicos).
 */

type VisibilityFilter = 'all' | 'public' | 'private'

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ok'; programs: NeutralProgramSummary[] }
  | { phase: 'no-token' }
  | { phase: 'error'; error: string; authProblem: boolean }

export function IntigritiProgramsTab({ localProjects }: { localProjects: string[] }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })

  const load = () => {
    setState({ phase: 'loading' })
    void getIntigritiProgramsAction().then((res) => {
      if (res.ok) {
        setState({ phase: 'ok', programs: res.programs })
      } else if (res.reason === 'no-token') {
        setState({ phase: 'no-token' })
      } else {
        setState({ phase: 'error', error: res.error, authProblem: res.authProblem ?? false })
      }
    })
  }

  useEffect(load, []) // carga solo al pulsar la subpestana (montaje diferido)

  const [query, setQuery] = useState('')
  const [visF, setVisF] = useState<VisibilityFilter>('all')
  const [bountyOnly, setBountyOnly] = useState(false)

  const programs = state.phase === 'ok' ? state.programs : []
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return programs.filter((p) => {
      if (visF === 'public' && !p.isPublic) return false
      if (visF === 'private' && p.isPublic) return false
      if (bountyOnly && !p.hasBounty) return false
      if (q) {
        const hay = `${p.title} ${p.slug}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [programs, query, visF, bountyOnly])

  // Detalle bajo demanda, con caché propia de esta subpestana
  const [detail, setDetail] = useState<NeutralProgramDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cache = useRef(new Map<string, NeutralProgramDetail>())
  const existing = useRef(new Set<string>())

  useEffect(() => {
    for (const p of localProjects) existing.current.add(p)
  }, [localProjects])

  const selectedId = detail?.id ?? null

  const select = (p: NeutralProgramSummary) => {
    const cached = cache.current.get(p.id)
    if (cached) {
      setDetail(cached)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setDetail(null)
    void getIntigritiProgramAction(p.id).then((res) => {
      if (cancelled) return
      setLoading(false)
      if (res.ok) {
        cache.current.set(p.id, res.program)
        setDetail(res.program)
      } else {
        setError(res.reason === 'no-token' ? 'Sin PAT: configúralo en Ajustes.' : res.error)
      }
    })
  }

  const selectClass =
    'rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:[color-scheme:dark]'

  if (state.phase === 'loading') {
    return <p className="px-2 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">Cargando programas de Intigriti…</p>
  }

  if (state.phase === 'no-token') {
    return (
      <div className="mt-4 max-w-xl rounded-md border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        <p className="font-medium">Intigriti necesita un token (PAT)</p>
        <p className="mt-1">
          La API de Intigriti no tiene endpoints públicos: sin un PAT personal no se puede listar
          nada. Créalo en la web (perfil → API → researcher) y pégalo en{' '}
          <Link href="/ajustes" className="underline">
            Ajustes → Intigriti
          </Link>
          .
        </p>
        <button
          type="button"
          onClick={load}
          className="mt-3 rounded-md border border-amber-400 px-3 py-1 text-xs font-medium hover:bg-amber-100 dark:border-amber-600 dark:hover:bg-amber-900"
        >
          Reintentar
        </button>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div>
        <div role="alert" className="mt-4 max-w-xl rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          <p>No se pudo cargar la lista de programas: {state.error}</p>
          {state.authProblem ? (
            <p className="mt-2">
              El PAT fue rechazado (401):{' '}
              <Link href="/ajustes" className="underline">
                revisa tu token en Ajustes
              </Link>
              .
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={load}
          className="mt-3 rounded-md border border-zinc-300 px-4 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <div>
      <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
        {programs.length} programas de Intigriti
        {programs.some((p) => !p.isPublic) ? ` (${programs.filter((p) => !p.isPublic).length} privados)` : ''}.
        El detalle trae scope por dominios, UA/header requeridos y reglas (ROE).
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre o handle…"
          aria-label="Buscar programas de Intigriti"
          className="w-64 rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700"
        />
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
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => select(p)}
                  aria-current={selectedId === p.id ? 'true' : undefined}
                  className={`block w-full px-3 py-2.5 text-left transition-colors ${
                    selectedId === p.id
                      ? 'bg-zinc-100 dark:bg-zinc-900'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">{p.title || p.slug}</span>
                    {!p.isPublic ? (
                      <span className="shrink-0 rounded-full border border-amber-300 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-700 dark:text-amber-300">
                        privado
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="min-w-0 truncate font-mono">{p.slug}</span>
                    <span className="shrink-0 tabular-nums">
                      {p.type}
                      {p.hasBounty ? ` · ${p.bountyMin}–${p.bountyMax}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>

        {/* Detalle */}
        <div className="min-w-0">
          {selectedId === null && !loading && !detail ? (
            <p className="rounded-md border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              Selecciona un programa para ver dominios, reglas y requisitos de testing.
            </p>
          ) : loading ? (
            <p className="px-2 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">Cargando detalle…</p>
          ) : error ? (
            <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          ) : detail ? (
            <ProgramDetail
              program={detail}
              platform="intigriti"
              existingProject={existing.current.has(detail.slug) ? detail.slug : undefined}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
