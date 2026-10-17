'use client'

import type { FindingDTO } from '@/app/escaneos/recon-actions'
import { severityLabel, severityStyle } from '@/core/recon/finding-view'

/**
 * Tarjeta de finding (Tarea 14): lectura visual por severidad. Click →
 * abre el detalle. Mismos datos que la tabla (es el mismo DTO).
 */

export function FindingCard({
  finding,
  onOpen,
  onCreateDraft,
  onPromote,
}: {
  finding: FindingDTO
  onOpen: (f: FindingDTO) => void
  onCreateDraft: (f: FindingDTO) => void
  onPromote: (f: FindingDTO) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(finding)}
      className="w-full rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-medium">{finding.name}</p>
        <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${severityStyle(finding.severity)}`}>
          {severityLabel(finding.severity)}
        </span>
      </div>
      <p className="mt-0.5 truncate font-mono text-xs text-zinc-400">({finding.templateId})</p>
      <p className="mt-1 truncate font-mono text-xs text-zinc-600 dark:text-zinc-300">@{finding.host}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
            {finding.triageConfianza !== undefined ? ` ${Math.round(finding.triageConfianza * 100)}%` : ''}
          </span>
        ) : (
          <span className="rounded bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600">
            sin triaje
          </span>
        )}
        <span className="text-[10px] text-zinc-400">visto {finding.lastSeenAt.slice(0, 10)}</span>
      </div>
      <div className="mt-2 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => onCreateDraft(finding)}
          className="rounded-md border border-zinc-300 px-2 py-0.5 text-[11px] hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Crear borrador
        </button>
        <button
          type="button"
          onClick={() => onPromote(finding)}
          title="Promueve este finding a la KB del proyecto (08c)"
          className="rounded-md border border-emerald-300 px-2 py-0.5 text-[11px] text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950"
        >
          Promover a KB
        </button>
      </div>
    </button>
  )
}
