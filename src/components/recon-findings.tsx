'use client'

import { useEffect, useState } from 'react'
import {
  classifyFindingsAction,
  createFindingDraftAction,
  syncFindingsAction,
  type FindingDTO,
} from '@/app/escaneos/recon-actions'
import { FINDING_SEVERITIES, type FindingSeverity } from '@/core/recon/findings'

/**
 * Tabla de findings del proyecto (Tarea 3): el índice se SINCRONIZA desde
 * los output.log en cada carga (el disco es la verdad, la tabla es
 * reconstruible). Cada fila puede crear un borrador de reporte.
 */

const SEVERITY_STYLE: Record<FindingSeverity, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  low: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  info: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
}

const TRIAGE_STYLE: Record<'real' | 'ruido' | 'dudoso', string> = {
  real: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  ruido: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400',
  dudoso: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
}

export function ReconFindingsSection({ project }: { project: string }) {
  const [findings, setFindings] = useState<FindingDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [severityFilter, setSeverityFilter] = useState<'all' | FindingSeverity>('all')
  const [note, setNote] = useState<{ ok: boolean; msg: string } | null>(null)
  const [triaging, setTriaging] = useState(false)

  const triage = () => {
    setTriaging(true)
    setNote(null)
    void classifyFindingsAction(project).then((res) => {
      setTriaging(false)
      if (res.ok) {
        setNote({
          ok: true,
          msg: `Triaje hecho: ${res.prefiltro ?? 0} por pre-filtro, ${res.sent ?? 0} al LLM · ${res.labels?.real ?? 0} real / ${res.labels?.ruido ?? 0} ruido / ${res.labels?.dudoso ?? 0} dudoso. Nada se ha borrado: tú decides.`,
        })
        refresh()
      } else {
        setNote({ ok: false, msg: `✗ ${res.error}` })
      }
    })
  }

  const refresh = () => {
    setBusy(true)
    void syncFindingsAction(project).then((res) => {
      setBusy(false)
      if (res.ok) {
        setFindings(res.findings)
        setError(null)
      } else {
        setError(res.error)
      }
    })
  }

  // Carga inicial: suscripción al sistema externo (la acción), setState solo
  // en el callback — nunca sincrono dentro del effect.
  useEffect(() => {
    let alive = true
    void syncFindingsAction(project).then((res) => {
      if (!alive) return
      if (res.ok) {
        setFindings(res.findings)
        setError(null)
      } else {
        setError(res.error)
      }
    })
    return () => {
      alive = false
    }
  }, [project])

  const createDraft = (f: FindingDTO) => {
    setNote(null)
    void createFindingDraftAction(project, {
      templateId: f.templateId,
      host: f.host,
      severity: f.severity,
      matchedAt: f.matchedAt,
      name: f.name,
    }).then((res) => {
      setNote(res.ok ? { ok: true, msg: `Borrador creado: ${res.path}` } : { ok: false, msg: `✗ ${res.error}` })
    })
  }

  const visible = (findings ?? []).filter((f) => severityFilter === 'all' || f.severity === severityFilter)

  return (
    <section aria-label="Findings de recon" className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Findings (salida estructurada, nuclei primero)</h3>
        <div className="flex items-center gap-2">
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as 'all' | FindingSeverity)}
            aria-label="Filtrar por severidad"
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-700 dark:[color-scheme:dark]"
          >
            <option value="all">todas las severidades</option>
            {[...FINDING_SEVERITIES].reverse().map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={triage}
            disabled={triaging || busy}
            title="El LLM pre-marca (real/ruido/dudoso); nunca borra. Requiere LLM configurado en Ajustes."
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {triaging ? 'Triaizando…' : 'Triaje LLM'}
          </button>
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {busy ? 'Sincronizando…' : 'Sincronizar desde disco'}
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Índice RECONSTRUIBLE: se repuebla de los output.log en cada sincronización. No es la fuente de verdad.
      </p>

      {error ? <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">✗ {error}</p> : null}
      {note ? (
        <p role={note.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${note.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          {note.msg}
        </p>
      ) : null}

      {findings !== null && findings.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Sin findings todavía: lanza nuclei y sincroniza.
        </p>
      ) : null}

      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        El triaje del LLM PRE-MARCA y queda en el log de ejecuciones; nunca borra. Ante la duda: dudoso.
      </p>

      {visible.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-1 pr-2 font-medium">Sev.</th>
                <th className="py-1 pr-2 font-medium">Finding</th>
                <th className="py-1 pr-2 font-medium">Host</th>
                <th className="py-1 pr-2 font-medium">Triaje</th>
                <th className="py-1 pr-2 font-medium">Match</th>
                <th className="py-1 pr-2 font-medium">Visto</th>
                <th className="py-1 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {visible.map((f) => (
                <tr key={`${f.templateId}-${f.host}`}>
                  <td className="py-1.5 pr-2">
                    <span className={`rounded px-1.5 py-0.5 font-mono ${SEVERITY_STYLE[f.severity]}`}>{f.severity}</span>
                  </td>
                  <td className="py-1.5 pr-2">
                    <span className="font-medium">{f.name}</span>
                    <span className="ml-1 font-mono text-zinc-500 dark:text-zinc-400">({f.templateId})</span>
                  </td>
                  <td className="py-1.5 pr-2 font-mono">{f.host}</td>
                  <td className="py-1.5 pr-2">
                    {f.triageLabel ? (
                      <span
                        title={`${f.triageRazon ?? ''}${f.triageConfianza !== undefined ? ` (confianza ${Math.round(f.triageConfianza * 100)}%)` : ''}`}
                        className={`cursor-help rounded px-1.5 py-0.5 ${TRIAGE_STYLE[f.triageLabel]}`}
                      >
                        {f.triageLabel}
                        {f.triageConfianza !== undefined ? ` ${Math.round(f.triageConfianza * 100)}%` : ''}
                      </span>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="max-w-72 truncate py-1.5 pr-2 font-mono" title={f.matchedAt}>{f.matchedAt || '—'}</td>
                  <td className="py-1.5 pr-2 text-zinc-500 dark:text-zinc-400">{f.lastSeenAt.slice(0, 10)}</td>
                  <td className="py-1.5">
                    <button
                      type="button"
                      onClick={() => createDraft(f)}
                      className="rounded-md border border-zinc-300 px-2 py-0.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                    >
                      Crear borrador
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
