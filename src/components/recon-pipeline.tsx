'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cancelPipelineAction,
  getPipelineStatusAction,
  planPipelineAction,
  startPipelineAction,
  type PipelinePlanDTO,
} from '@/app/escaneos/recon-actions'
import type { PipelineSnapshot } from '@/server/recon-pipeline'

/**
 * Pantalla "Plan" del pipeline (pestaña Recon): el SERVIDOR propone las
 * etapas según el scope del programa; el humano activa/desactiva etapas y
 * lanza. El gate corta antes de las etapas activo/explotación salvo
 * confirmación explícita (o autorización en las reglas).
 */

const STATUS_STYLE: Record<PipelineSnapshot['stages'][number]['status'], { text: string; cls: string }> = {
  done: { text: 'hecha', cls: 'text-emerald-600 dark:text-emerald-400' },
  error: { text: 'error', cls: 'text-red-600 dark:text-red-400' },
  empty: { text: 'sin resultados', cls: 'text-amber-600 dark:text-amber-400' },
  gate: { text: '⛔ pide confirmación', cls: 'text-amber-600 dark:text-amber-400' },
  cancelled: { text: 'cancelada', cls: 'text-red-600 dark:text-red-400' },
  skipped: { text: 'omitida', cls: 'text-zinc-500 dark:text-zinc-400' },
}

const RISK_STYLE: Record<string, string> = {
  passive: 'text-zinc-600 dark:text-zinc-300',
  light: 'text-amber-600 dark:text-amber-400',
  active: 'text-red-600 dark:text-red-400',
  exploitation: 'text-red-600 dark:text-red-400',
}

export function ReconPipelineSection({ project, onRunsChanged }: { project: string; onRunsChanged?: () => void }) {
  const [plan, setPlan] = useState<PipelinePlanDTO | null>(null)
  const [planBusy, setPlanBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmed, setConfirmed] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<PipelineSnapshot | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (pollRef.current) clearTimeout(pollRef.current)
    },
    [],
  )

  const poll = useCallback(
    (id: string) => {
      const tick = (pid: string) => {
        pollRef.current = setTimeout(() => {
          void getPipelineStatusAction(pid).then((snap) => {
            if (!snap) return
            setSnapshot(snap)
            if (snap.status === 'running') tick(pid)
            else onRunsChanged?.()
          })
        }, 1200)
      }
      tick(id)
    },
    [onRunsChanged],
  )

  const generate = () => {
    setPlanBusy(true)
    setLaunchError(null)
    setSnapshot(null)
    void planPipelineAction(project).then((p) => {
      setPlan(p)
      setPlanBusy(false)
      if (p.ok && p.stages) setSelected(new Set(p.stages.map((s) => s.toolId)))
    })
  }

  const running = snapshot?.status === 'running'
  const stages = plan?.ok ? (plan.stages ?? []) : []
  const orderedSelected = stages.filter((s) => selected.has(s.toolId)).map((s) => s.toolId)
  const anyGatedSelected = stages.some((s) => selected.has(s.toolId) && s.gated)

  const launch = () => {
    if (orderedSelected.length === 0 || running) return
    setLaunchError(null)
    void startPipelineAction(project, orderedSelected, confirmed).then((res) => {
      if (res.ok) {
        setSnapshot({ id: res.pipelineId, project, status: 'running', startedAt: new Date().toISOString(), stages: [] })
        poll(res.pipelineId)
      } else {
        setLaunchError(res.error)
      }
    })
  }

  const cancel = () => {
    if (!running) return
    void cancelPipelineAction(snapshot!.id)
  }

  const toggleStage = (toolId: string) => {
    const next = new Set(selected)
    if (next.has(toolId)) next.delete(toolId)
    else next.add(toolId)
    setSelected(next)
  }

  return (
    <section aria-label="Pipeline encadenado" className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Pipeline (encadenado determinista, sin LLM)</h3>
        <button
          type="button"
          onClick={generate}
          disabled={planBusy || running}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {planBusy ? 'Calculando…' : 'Generar plan según el scope'}
        </button>
      </div>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        El servidor propone las etapas según la forma del scope (wildcard / host / URL): enumerar → resolver → httpx →
        crawl → gf → activo, y las URLs del scope a sqlmap/dalfox. Tú eliges etapas y apruebas; nada se lanza solo.
      </p>

      {plan && !plan.ok ? (
        <p role="alert" className="mt-2 text-sm text-amber-600 dark:text-amber-400">⚠ {plan.reason}</p>
      ) : null}

      {plan?.ok ? (
        <>
          <ul className="mt-3 space-y-1.5">
            {stages.map((s) => (
              <li key={s.toolId} className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={selected.has(s.toolId)} onChange={() => toggleStage(s.toolId)} disabled={running} />
                  <span className={`font-medium ${RISK_STYLE[s.risk] ?? ''}`}>{s.label}</span>
                </label>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {s.source === 'prev' ? '(salida de la etapa anterior)' : `targets: ${s.targets.join(', ') || '—'}`}
                </span>
                {s.gated ? (
                  <span className="rounded border border-amber-300 px-1.5 py-0.5 text-[10px] text-amber-700 dark:border-amber-700 dark:text-amber-300">
                    requiere confirmación
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {plan.ignored && plan.ignored.length > 0 ? (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              Entradas del scope ignoradas por forma inválida: {plan.ignored.join(', ')}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={launch}
              disabled={running || orderedSelected.length === 0}
              className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {running ? 'Pipeline en marcha…' : 'Lanzar pipeline'}
            </button>
            {running ? (
              <button type="button" onClick={cancel} className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950">
                Cancelar pipeline
              </button>
            ) : null}
            {anyGatedSelected ? (
              <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                Confirmo haber leído las reglas del programa (exigido para etapas activas y de explotación)
              </label>
            ) : null}
          </div>
        </>
      ) : null}

      {launchError ? (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">✗ {launchError}</p>
      ) : null}

      {snapshot ? (
        <div className="mt-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="text-xs">
            <span className="font-medium">{snapshot.id}</span>{' '}
            <span className={snapshot.status === 'running' ? 'text-sky-600 dark:text-sky-400' : snapshot.status === 'done' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
              {snapshot.status === 'running' ? 'en marcha' : snapshot.status === 'done' ? 'terminado' : snapshot.status === 'cancelled' ? 'cancelado' : 'parado'}
            </span>
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {snapshot.stages.map((st, i) => {
              const style = STATUS_STYLE[st.status]
              return (
                <li key={`${st.toolId}-${i}`} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{st.toolId}</span>
                  <span className={style.cls}>{style.text}</span>
                  {st.itemCount !== undefined ? <span className="text-zinc-500 dark:text-zinc-400">({st.itemCount} items en scope)</span> : null}
                  {st.error ? <span className="text-zinc-500 dark:text-zinc-400">— {st.error}</span> : null}
                </li>
              )
            })}
          </ul>
          {snapshot.reason ? <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{snapshot.reason}</p> : null}
        </div>
      ) : null}
    </section>
  )
}
