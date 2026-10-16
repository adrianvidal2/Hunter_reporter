'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import {
  cancelAuditAction,
  getAuditRulesInfoAction,
  getAuditStatusAction,
  startAuditAction,
} from '@/app/proyectos/[project]/audit-actions'

/**
 * Auditoría completa (Tarea 12c): UN botón humano dispara
 * recon → misión → agente (12b), con las dos vías (con/sin recon),
 * estado en vivo por fases y kill switch. El aviso de reglas del programa
 * es INFORMATIVO: nunca bloquea (decisión del operador).
 */

const PHASE_LABEL: Record<string, string> = {
  recon: '1 · Recon (pipeline completo)',
  mision: '2 · Misión (ensamblado)',
  agente: '3 · Agente (Orca)',
  done: '✅ Auditoría lanzada',
  cancelled: '🛑 Cancelada por el operador',
  error: '✗ Error',
}

export function AuditPanel({ project }: { project: string }) {
  const [runRecon, setRunRecon] = useState(true)
  const [phase, setPhase] = useState<string | null>(null)
  const [rulesState, setRulesState] = useState<string | null>(null)
  const [rulesReason, setRulesReason] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const refresh = useCallback(() => {
    startTransition(async () => {
      const [statusRes, rulesRes] = await Promise.all([
        getAuditStatusAction(project),
        getAuditRulesInfoAction(project),
      ])
      if (statusRes.ok && statusRes.status) {
        setPhase(statusRes.status.phase)
        if (statusRes.status.error) setError(statusRes.status.error)
      }
      if (rulesRes.ok && rulesRes.state) {
        setRulesState(rulesRes.state)
        setRulesReason(rulesRes.reason ?? null)
      }
    })
  }, [project])

  useEffect(() => {
    refresh()
  }, [refresh])

  // polling en vivo mientras corre la auditoría
  useEffect(() => {
    if (phase === null || ['done', 'cancelled', 'error'].includes(phase)) return
    const t = setInterval(refresh, 2_000)
    return () => clearInterval(t)
  }, [phase, refresh])

  const running = phase !== null && ['recon', 'mision', 'agente'].includes(phase)

  const start = (withRecon: boolean) => {
    setError(null)
    startTransition(async () => {
      const res = await startAuditAction(project, withRecon)
      if (!res.ok) {
        setError(res.error ?? 'No se pudo iniciar la auditoría')
        return
      }
      setPhase(res.phase ?? 'recon')
      refresh()
    })
  }

  const cancel = () => {
    startTransition(async () => {
      await cancelAuditAction(project)
      refresh()
    })
  }

  return (
    <section aria-label="Auditoría completa" className="rounded-md border border-zinc-900 p-4 dark:border-zinc-100">
      <h3 className="text-sm font-semibold">Auditoría completa (recon → misión → agente)</h3>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Un solo disparo humano: el clic ES la autorización y el flujo corre desatendido.
        Las reglas del programa son solo un aviso informativo — tu decisión manda.
      </p>

      {rulesState ? (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          ⚠️ Reglas del programa: <strong>{rulesState}</strong>
          {rulesReason ? ` — ${rulesReason}` : ''} <em>(informativo: NO bloquea el lanzamiento)</em>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {phase ? (
        <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <p className="font-medium">
            Estado: <span className={running ? 'text-sky-600 dark:text-sky-400' : ''}>{PHASE_LABEL[phase] ?? phase}</span>
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">recon → misión → agente</p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {!running && phase !== 'done' ? (
          <>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={runRecon} onChange={(e) => setRunRecon(e.target.checked)} />
              Incluir recon (sin esta opción va directo a misión → agente)
            </label>
            <button
              type="button"
              onClick={() => start(runRecon)}
              disabled={pending}
              title="Dispara recon → misión → agente. El clic ES la autorización."
              className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {pending ? 'Iniciando…' : 'Auditoría completa'}
            </button>
          </>
        ) : running ? (
          <button
            type="button"
            onClick={cancel}
            disabled={pending}
            className="rounded-md border border-red-300 px-4 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
          >
            🛑 Kill switch — Cancelar auditoría
          </button>
        ) : null}
        {phase === 'done' || phase === 'cancelled' || phase === 'error' ? (
          <button
            type="button"
            onClick={() => {
              setPhase(null)
              setError(null)
            }}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Nueva auditoría
          </button>
        ) : null}
      </div>
    </section>
  )
}
