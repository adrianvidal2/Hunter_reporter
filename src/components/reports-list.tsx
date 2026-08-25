'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { refreshReportsAction, saveReportsColumnsAction } from '@/app/reportes/actions'
import {
  defaultSortReports,
  filterReportsByState,
  formatReward,
  reportStateLabel,
  reportStateOptions,
  reportWebUrl,
  sortReports,
  type ReportSortKey,
  type SortDir,
} from '@/core/ywh/reports'
import { REPORT_COLUMNS, widthFor } from '@/core/ywh/column-widths'
import type { UserReport } from '@/core/ywh/reports'

/**
 * Lista "mis reportes" de YesWeHack (ventana global, SOLO LECTURA).
 *
 * - Se pinta SIEMPRE desde la cache; "Actualizar" hace llamada en vivo.
 * - Columnas redimensionables arrastrando el borde de la cabecera; los
 *   anchos se persisten en `.config/reports-columns.json` (no localStorage).
 * - El arrastre (resize) está SEPARADO del clic (orden): el handle de la
 *   cabecera captura el puntero y solo ordena el clic que no arrastra.
 *
 * Layout: una sola fila por reporte; el grid usa `grid-template-columns`
 * explícito con el ancho de cada columna, compartido por cabecera y filas.
 */

const RX = 6 // umbral (px) para distinguir arrastre de clic: bajo este, es clic

/** Etiquetas de columna para la cabecera. */
const COL_LABEL: Record<ReportSortKey, string> = {
  title: 'Reporte',
  program: 'Programa',
  state: 'Estado',
  severity: 'Severidad',
  reward: 'Recompensa',
  date: 'Fecha',
}

const RIGHT_ALIGNED: Record<ReportSortKey, boolean> = {
  reward: true,
  title: false,
  program: false,
  state: false,
  severity: false,
  date: false,
}

/** Badge de estado con la paleta de severidad (border+text como CVSS). */
const STATE_BADGE: Record<string, string> = {
  under_review: 'border-amber-300 text-amber-600 dark:border-amber-800 dark:text-amber-400',
  new: 'border-amber-300 text-amber-600 dark:border-amber-800 dark:text-amber-400',
  triaged: 'border-orange-300 text-orange-600 dark:border-orange-800 dark:text-orange-400',
  accepted: 'border-sky-300 text-sky-600 dark:border-sky-800 dark:text-sky-400',
  resolved: 'border-sky-300 text-sky-600 dark:border-sky-800 dark:text-sky-400',
  informative: 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400',
  duplicated: 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400',
  duplicate: 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400',
  closed: 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400',
  rejected: 'border-red-300 text-red-600 dark:border-red-800 dark:text-red-400',
  invalid: 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400',
}

/** Punto de severidad con la MISMA paleta del reward grid. */
const CVSS_DOT: Record<string, string> = {
  C: 'bg-red-500',
  H: 'bg-orange-500',
  M: 'bg-amber-400',
  L: 'bg-sky-500',
  N: 'bg-zinc-300',
}

function fmtAge(ms: number): string {
  if (ms <= 0) return ''
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'hace <1 min'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return `hace ${d} d`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function ReportsList({
  initialItems,
  cachedAt,
  initialWidths,
}: {
  initialItems: UserReport[]
  cachedAt: number | null
  initialWidths?: Partial<Record<ReportSortKey, number>>
}) {
  const [items, setItems] = useState<UserReport[]>(initialItems)
  const [at, setAt] = useState<number | null>(cachedAt)
  const [error, setError] = useState<string | null>(null)
  const [stateFilter, setStateFilter] = useState('')
  const [sortKey, setSortKey] = useState<ReportSortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  // Antes de tocar ninguna cabecera, NO hay orden por columna: se usa el
  // orden INICIAL por defecto (grupos de estado + fecha desc). El primer
  // clic en una cabecera hace que ESE orden mande (reemplaza, no combina).
  const [userSorted, setUserSorted] = useState(false)
  const [pending, startTransition] = useTransition()

  // Anchos por columna (init desde config)
  const initWidths = useMemo(
    () => Object.fromEntries(REPORT_COLUMNS.map((k) => [k, widthFor(initialWidths, k)])) as Record<ReportSortKey, number>,
    [initialWidths],
  )
  const [widths, setWidths] = useState<Record<ReportSortKey, number>>(initWidths)

  // Estado del arrastre de resize: ref mutable + booster de render.
  const resizeRef = useRef<{ key: ReportSortKey; startX: number; startW: number; moved: boolean } | null>(null)
  const [, forceTick] = useState(0)

  // Opciones de estado DERIVADAS de la cache.
  const stateOptions = useMemo(() => reportStateOptions(items), [items])
  // Orden inicial = por estado (defaultSortReports); al hacer clic en una
  // cabecera, ese orden reemplaza al de estado. El filtro va por encima.
  const visible = useMemo(
    () => {
      const filtered = filterReportsByState(items, stateFilter)
      return userSorted
        ? sortReports(filtered, sortKey, sortDir)
        : defaultSortReports(filtered)
    },
    [items, stateFilter, sortKey, sortDir, userSorted],
  )

  const toggleSort = (key: ReportSortKey) => {
    // Si acaba de arrastrar en esta cabecera, no ordenes.
    if (resizeRef.current?.key === key && resizeRef.current.moved) return
    setUserSorted(true)
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  // Persistir anchos a config (vacío mejorado en todo el set).
  useEffect(() => {
    const t = setTimeout(() => {
      void saveReportsColumnsAction(widths)
    }, 400)
    return () => clearTimeout(t)
  }, [widths])

  // Global listeners de arrastre (los atachamos mientras se arrastra).
  useEffect(() => {
    if (!resizeRef.current) return

    const onMove = (e: PointerEvent) => {
      const r = resizeRef.current
      if (!r) return
      const dx = e.clientX - r.startX
      if (Math.abs(dx) > RX) r.moved = true
      const next = widthFor({ [r.key]: r.startW + dx }, r.key)
      setWidths((w) => (w[r.key] === next ? w : { ...w, [r.key]: next }))
    }
    const onUp = () => {
      resizeRef.current = null
      forceTick((n) => n + 1)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [resizeRef.current !== null])

  const startResize = (e: React.PointerEvent, key: ReportSortKey) => {
    e.preventDefault() // no iniciar selección de texto ni scroll
    e.stopPropagation() // no disparar el clic de orden
    const startW = widths[key]
    resizeRef.current = { key, startX: e.clientX, startW, moved: false }
    forceTick((n) => n + 1)
  }

  const gridTemplate = widths

  const refresh = () => {
    setError(null)
    startTransition(async () => {
      const res = await refreshReportsAction()
      if (res.ok) {
        setItems(res.view.items)
        setAt(res.view.cachedAt)
      } else {
        setItems(res.view.items)
        setAt(res.view.cachedAt)
        setError(res.error)
      }
    })
  }

  // Template del grid: una columna con su ancho px por clave.
  const columnsStyle = {
    gridTemplateColumns: REPORT_COLUMNS.map((k) => `${gridTemplate[k]}px`).join(' '),
  } as const

  const renderHeader = () => (
    <div className="grid items-center px-1 pb-1" style={columnsStyle}>
      {REPORT_COLUMNS.map((key) => {
        const active = userSorted && sortKey === key
        return (
          <div
            key={key}
            className={`group relative flex min-w-0 items-center ${RIGHT_ALIGNED[key] ? 'justify-end' : ''}`}
          >
            <button
              type="button"
              onClick={() => toggleSort(key)}
              className={`flex min-w-0 cursor-pointer items-center gap-1 px-1 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors hover:text-zinc-700 dark:hover:text-zinc-200 ${
                active ? 'text-zinc-700 dark:text-zinc-200' : 'text-zinc-400'
              }`}
              title={`Ordenar por ${COL_LABEL[key]}`}
            >
              <span className="truncate">{COL_LABEL[key]}</span>
              <span aria-hidden="true" className={`shrink-0 text-[9px] ${active ? 'opacity-100' : 'opacity-30'}`}>
                {active ? (sortDir === 'asc' ? '▲' : '▼') : '▲'}
              </span>
            </button>
            {/* Handle de resize (visible al hover del borde) */}
            <div
              onPointerDown={(e) => startResize(e, key)}
              className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none select-none opacity-0 transition-opacity group-hover:opacity-100"
              title="Arrastra para redimensionar"
            >
              <div className="absolute inset-y-0 right-0 w-px bg-zinc-300 dark:bg-zinc-600" aria-hidden="true" />
            </div>
          </div>
        )
      })}
    </div>
  )

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {items.length} reportes{stateFilter !== '' ? ` · ${visible.length} en «${reportStateLabel(stateFilter)}»` : ''}
          {at != null ? ` · actualizado ${fmtAge(Date.now() - at)}` : ''}
        </p>
        <div className="flex items-center gap-2">
          {stateOptions.length > 0 ? (
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              aria-label="Filtrar por estado"
              className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:[color-scheme:dark]"
            >
              <option value="">Todos</option>
              {stateOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
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
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}. Se muestra lo último guardado.
        </p>
      ) : null}

      {items.length === 0 ? (
        <div className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
          <p>No hay reportes en la cache todavía.</p>
          <button
            type="button"
            onClick={refresh}
            disabled={pending}
            className="mt-3 rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Actualizar
          </button>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          {/* Cabecera clicable */}
          {renderHeader()}

          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {visible.length === 0 ? (
              <li className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                No hay reportes en este estado.
              </li>
            ) : (
              visible.map((r) => {
                const state = r.status?.workflow_state ?? ''
                const crit = r.cvss?.criticity ?? ''
                return (
                  <li key={r.id || r.local_id} className="grid items-center gap-2 px-1 py-3.5 text-sm" style={columnsStyle}>
                    {/* TÍTULO */}
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-zinc-900 dark:text-zinc-100" title={r.title || r.local_id}>
                        {r.title || r.local_id}
                      </span>
                      <a
                        href={reportWebUrl(r)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                        title={`Abrir en YesWeHack: ${r.title}`}
                      >
                        ↗
                      </a>
                    </span>
                    {/* PROGRAMA */}
                    <span className="min-w-0 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400" title={r.program?.title || r.program?.slug}>
                      {r.program?.title || r.program?.slug || '—'}
                    </span>
                    {/* ESTADO */}
                    <span>
                      <span className={`inline-block max-w-full truncate rounded-full border px-2.5 py-1 text-xs font-medium ${STATE_BADGE[state] ?? 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400'}`}>
                        {reportStateLabel(state)}
                      </span>
                    </span>
                    {/* SEVERIDAD */}
                    <span className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${CVSS_DOT[crit] ?? 'bg-zinc-300'}`} aria-hidden="true" />
                      <span className="tabular-nums">{crit ? `${r.cvss?.score ?? ''}` : '—'}</span>
                    </span>
                    {/* RECOMPENSA */}
                    <span className="text-right tabular-nums text-zinc-700 dark:text-zinc-200">
                      {formatReward(r.reward, r.currency)}
                    </span>
                    {/* FECHA */}
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{fmtDate(r.created_at)}</span>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
