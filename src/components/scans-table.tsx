'use client'

import { useState, useTransition } from 'react'
import {
  focusTerminalAction,
  readTerminalAction,
  refreshScansAction,
} from '@/app/escaneos/actions'
import type { ScanRow } from '@/server/scans'

/**
 * Escaneos: una FILA POR AGENTE del lanzamiento (Entradas de launches.json).
 * El estado es EN VIVO (se pide al abrir y con «Actualizar»; nunca
 * cacheado). Un handle ausente en terminal list → «Sesión cerrada».
 *
 * - `project`: si se pasa, es la vista POR PROYECTO (oculta la columna
 *   Proyecto y refresca solo ese proyecto); si no, la vista GLOBAL.
 */

const STATUS_BADGE: Record<string, string> = {
  active: 'border-emerald-300 text-emerald-600 dark:border-emerald-800 dark:text-emerald-400',
  idle: 'border-amber-300 text-amber-600 dark:border-amber-800 dark:text-amber-400',
  dead: 'border-red-300 text-red-600 dark:border-red-800 dark:text-red-400',
  closed: 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400',
  unknown: 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400',
}

function fmtDate(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

export function ScansTable({
  initial,
  liveError = undefined,
  project,
}: {
  initial: ScanRow[]
  liveError?: string
  /** Vista por proyecto: refresca filtrado y oculta la columna Proyecto. */
  project?: string
}) {
  const [rows, setRows] = useState<ScanRow[]>(initial)
  const [error, setError] = useState<string | null>(null)
  const [output, setOutput] = useState<{ handle: string; text: string } | null>(null)
  const [promptView, setPromptView] = useState<{ label: string; prompt: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const refresh = () => {
    setError(null)
    startTransition(async () => {
      const res = await refreshScansAction(project)
      if (res.ok) setRows(res.rows)
      else setError(res.error)
    })
  }

  const focus = (row: ScanRow) => {
    if (!row.handle) return
    setError(null)
    startTransition(async () => {
      const res = await focusTerminalAction(row.handle!)
      if (!res.ok) setError(res.error)
    })
  }

  const viewOutput = (row: ScanRow) => {
    if (!row.handle) return
    setError(null)
    startTransition(async () => {
      const res = await readTerminalAction(row.handle!)
      if (res.ok) setOutput({ handle: row.handle!, text: res.output })
      else setError(res.error)
    })
  }

  const gridCols = project
    ? 'grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1fr)_auto]'
    : 'grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1fr)_auto]'

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {rows.length} agentes{liveError ? ` · ${liveError}` : ''}
        </p>
        {liveError ? (
          <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">
            {liveError}
          </p>
        ) : null}
        <button
          type="button"
          onClick={refresh}
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
          No hay escaneos todavía. Lanza agentes desde la pestaña Programa.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          {/* Cabecera */}
          <div className={`grid items-center gap-3 px-1 pb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-400 ${gridCols}`}>
            {project ? null : <span>Proyecto</span>}
            <span>Label del agente</span>
            <span>Provider</span>
            <span>Lanzado</span>
            <span>Estado</span>
            <span>Última actividad</span>
            <span className="align-right" />
          </div>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((r, i) => (
              <li key={`${r.project}-${r.timestamp}-${i}`} className={`grid items-center gap-3 px-1 py-3 text-sm ${gridCols}`}>
                {project ? null : (
                  <span className="min-w-0 truncate font-medium" title={r.project}>{r.project}</span>
                )}
                <span className="min-w-0 truncate font-medium" title={`${r.label} (${r.provider})`}>
                  {r.label}
                </span>
                <span className="min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400">{r.provider}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{fmtDate(r.timestamp)}</span>
                <span>
                  {r.launchOk ? (
                    <span className={`inline-block max-w-full truncate rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[r.status] ?? STATUS_BADGE.unknown!}`}>
                      {r.statusLabel}
                    </span>
                  ) : (
                    <span
                      className="inline-block max-w-full truncate rounded-full border border-red-300 px-2.5 py-1 text-xs font-medium text-red-600 dark:border-red-800 dark:text-red-400"
                      title={r.launchError}
                    >
                      Error de lanzamiento
                    </span>
                  )}
                  {r.title && r.launchOk ? <span className="ml-2 text-xs text-zinc-400" title={r.title}>{r.title}</span> : null}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {r.launchOk ? r.lastActivityLabel : (r.launchError ?? '—')}
                </span>
                <span className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPromptView({ label: r.label, prompt: r.prompt ?? '(sin prompt guardado)' })}
                    className="shrink-0 rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                    title="Ver el prompt inicial con el que se lanzó"
                  >
                    Ver prompt
                  </button>
                  <button
                    type="button"
                    onClick={() => focus(r)}
                    disabled={pending || !r.handle || !r.launchOk}
                    className="shrink-0 rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
                    title="Abrir la sesión en Orca"
                  >
                    Abrir en Orca
                  </button>
                  <button
                    type="button"
                    onClick={() => viewOutput(r)}
                    disabled={pending || !r.handle || !r.launchOk}
                    className="shrink-0 rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
                    title="Ver las últimas líneas de salida"
                  >
                    Ver salida
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Panel: salida en vivo */}
      {output ? (
        <div className="mt-4 rounded-md border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <p className="text-sm font-medium">Salida de {output.handle}</p>
            <button type="button" onClick={() => setOutput(null)} className="text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
              Cerrar ✕
            </button>
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
            {output.text || '(sin salida)'}
          </pre>
        </div>
      ) : null}

      {/* Panel: prompt inicial del agente */}
      {promptView ? (
        <div className="mt-4 rounded-md border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <p className="text-sm font-medium">Prompt inicial · {promptView.label}</p>
            <button type="button" onClick={() => setPromptView(null)} className="text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
              Cerrar ✕
            </button>
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
            {promptView.prompt}
          </pre>
        </div>
      ) : null}
    </div>
  )
}