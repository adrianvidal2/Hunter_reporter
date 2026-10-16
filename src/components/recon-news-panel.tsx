'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import {
  clearReconNewsAction,
  getScheduleStatusAction,
  listReconNewsAction,
  runCycleNowAction,
  setScheduleAction,
  type ScheduleProjectStatus,
} from '@/app/novedades/actions'

/**
 * Panel de novedades de monitorización (Tarea 9c): estado del scheduler por
 * proyecto (toggle opt-in + intervalo + ciclo manual) y lista de assets
 * nuevos, en vivo por el canal SSE (`recon-news`).
 */

interface NewsItem {
  project: string
  tool: string
  item: string
  firstSeenAt: string
  lastSeenAt: string
}

export function ReconNewsPanel({ projects }: { projects: string[] }) {
  const [status, setStatus] = useState<ScheduleProjectStatus[]>([])
  const [news, setNews] = useState<NewsItem[]>([])
  const [projectFilter, setProjectFilter] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const refresh = useCallback(() => {
    startTransition(async () => {
      const [statusRes, newsRes] = await Promise.all([
        getScheduleStatusAction(),
        listReconNewsAction(projectFilter || undefined),
      ])
      if (statusRes.ok && statusRes.projects) setStatus(statusRes.projects)
      if (newsRes.ok) setNews(newsRes.news)
      if (!statusRes.ok) setError(statusRes.error ?? 'Error')
      else setError(null)
    })
  }, [projectFilter])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Avisos en vivo por el canal SSE existente (evento `recon-news`, 9b)
  useEffect(() => {
    const es = new EventSource('/api/events')
    const onNews = (e: MessageEvent<string>) => {
      const data = JSON.parse(e.data) as { project: string }
      if (projectFilter === '' || data.project === projectFilter) refresh()
    }
    es.addEventListener('recon-news', onNews as EventListener)
    es.onerror = () => es.close()
    return () => {
      es.removeEventListener('recon-news', onNews as EventListener)
      es.close()
    }
  }, [projectFilter, refresh])

  const toggle = (project: string, enabled: boolean) => {
    startTransition(async () => {
      const res = await setScheduleAction(project, { enabled })
      if (!res.ok) setError(res.error ?? 'Error')
      refresh()
    })
  }

  const changeInterval = (project: string, intervalMinutes: number) => {
    startTransition(async () => {
      const res = await setScheduleAction(project, { intervalMinutes })
      if (!res.ok) setError(res.error ?? 'Error')
      refresh()
    })
  }

  const runNow = (project: string) => {
    startTransition(async () => {
      const res = await runCycleNowAction(project)
      if (!res.ok) setError(res.error ?? 'Error')
      refresh()
    })
  }

  const clearNews = () => {
    startTransition(async () => {
      await clearReconNewsAction(projectFilter || undefined)
      refresh()
    })
  }

  const visibleNews = news.filter((n) => projectFilter === '' || n.project === projectFilter)

  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {/* Estado del scheduler por proyecto */}
      <section aria-label="Monitorización por proyecto" className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Monitorización por proyecto (opt-in)</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Solo etapas <strong>pasivas/ligeras</strong> del plan (subfinder → dnsx → httpx → katana → gf). Lo
          activo/explotación NUNCA se auto-lanza. Intervalo mínimo: 15 minutos.
        </p>
        {status.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Sin proyectos.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            {status.map((s) => (
              <li key={s.project} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {s.project}
                    {s.enabled ? (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        monitorizando
                      </span>
                    ) : null}
                    {!s.hasProgram ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        sin programa.json
                      </span>
                    ) : null}
                  </p>
                  <p className="font-mono text-xs text-zinc-400">
                    {s.lastCycleAt ? `último ciclo: ${s.lastCycleAt.replace('T', ' ').slice(0, 19)}` : 'sin ciclos aún'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={(e) => toggle(s.project, e.target.checked)}
                      disabled={pending}
                    />
                    activa
                  </label>
                  <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300">
                    cada
                    <input
                      type="number"
                      min={15}
                      value={s.intervalMinutes}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        if (Number.isFinite(v) && v >= 15) changeInterval(s.project, v)
                      }}
                      aria-label={`Intervalo de ${s.project} (minutos)`}
                      className="w-16 rounded-md border border-zinc-300 bg-transparent px-1.5 py-1 text-xs dark:border-zinc-700"
                    />
                    min
                  </label>
                  <button
                    type="button"
                    onClick={() => runNow(s.project)}
                    disabled={pending || !s.enabled || !s.hasProgram}
                    title="Lanza UN ciclo ahora (solo pasivo/ligero)"
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    Ciclo ahora
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Novedades */}
      <section aria-label="Novedades de monitorización" className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            Assets nuevos <span className="text-zinc-400">({visibleNews.length})</span>
          </h2>
          <div className="flex items-center gap-2">
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              aria-label="Filtrar por proyecto"
              className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-700 dark:[color-scheme:dark]"
            >
              <option value="">todos los proyectos</option>
              {projects.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={clearNews}
              disabled={pending}
              title="Vacía el índice de novedades (es reconstruible; no es la fuente de verdad)"
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Limpiar
            </button>
          </div>
        </div>

        {visibleNews.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Sin novedades todavía: activa un proyecto y espera un ciclo (o pulsa «Ciclo ahora»).
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            {visibleNews.map((n) => (
              <li key={`${n.project}-${n.tool}-${n.item}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 font-mono text-xs">
                  <span className="font-semibold">{n.item}</span>{' '}
                  <span className="text-zinc-400">
                    · {n.tool} · {n.project}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                  visto: {n.lastSeenAt.slice(0, 16).replace('T', ' ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
