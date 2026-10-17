'use client'

import Link from 'next/link'
import type { FindingDTO } from '@/app/escaneos/recon-actions'
import { severityLabel, severityStyle } from '@/core/recon/finding-view'

/**
 * Detalle de un finding (Tarea 14): modal con TODOS los datos —
 * matched-at, triaje (razón/confianza), first/last seen, run de origen —
 * y las acciones existentes (crear borrador, promover a KB).
 */

export function FindingDetail({
  finding,
  project,
  onClose,
  onCreateDraft,
  onPromote,
}: {
  finding: FindingDTO
  project: string
  onClose: () => void
  onCreateDraft: (f: FindingDTO) => void
  onPromote: (f: FindingDTO) => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-900/60 p-4 pt-16 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Detalle de ${finding.name}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${severityStyle(finding.severity)}`}>
                {severityLabel(finding.severity)}
              </span>
              {finding.triageLabel ? (
                <span
                  title={finding.triageRazon ?? ''}
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    finding.triageLabel === 'real'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : finding.triageLabel === 'ruido'
                        ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                  }`}
                >
                  triaje: {finding.triageLabel}
                  {finding.triageConfianza !== undefined ? ` · confianza ${Math.round(finding.triageConfianza * 100)}%` : ''}
                </span>
              ) : null}
            </div>
            <h3 className="mt-1 text-lg font-semibold">{finding.name}</h3>
            <p className="font-mono text-xs text-zinc-400">
              {finding.templateId} · {finding.toolId} · {finding.runDir}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
            ✕
          </button>
        </div>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-zinc-500 dark:text-zinc-400">Host</dt>
          <dd className="font-mono">{finding.host}</dd>
          <dt className="text-zinc-500 dark:text-zinc-400">Matched-at</dt>
          <dd className="break-all font-mono">{finding.matchedAt || '—'}</dd>
          <dt className="text-zinc-500 dark:text-zinc-400">Primera vez</dt>
          <dd className="font-mono">{finding.firstSeenAt.replace('T', ' ').slice(0, 19)}</dd>
          <dt className="text-zinc-500 dark:text-zinc-400">Última vez</dt>
          <dd className="font-mono">{finding.lastSeenAt.replace('T', ' ').slice(0, 19)}</dd>
          {finding.triageRazon ? (
            <>
              <dt className="text-zinc-500 dark:text-zinc-400">Triaje</dt>
              <dd>
                {finding.triageLabel}
                {finding.triageConfianza !== undefined ? ` (${Math.round(finding.triageConfianza * 100)}%)` : ''} —{' '}
                {finding.triageRazon}
                <span className="block text-xs text-zinc-400">
                  Lead del LLM: pre-marca, no confirmación. Verifica antes de creer.
                </span>
              </dd>
            </>
          ) : null}
        </dl>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onCreateDraft(finding)}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Crear borrador
          </button>
          <button
            type="button"
            onClick={() => onPromote(finding)}
            title="Promueve este finding a la KB del proyecto (08c)"
            className="rounded-md border border-emerald-300 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950"
          >
            Promover a KB
          </button>
          <Link
            href={`/proyectos/${encodeURIComponent(project)}`}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Ver proyecto
          </Link>
        </div>
      </div>
    </div>
  )
}
