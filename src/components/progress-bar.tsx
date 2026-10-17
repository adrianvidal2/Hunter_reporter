'use client'

import type { ProgressSegment, SegState } from '@/core/recon/progress'

/**
 * Barra de progreso segmentada (Tarea 13): un segmento por fase/etiqueta.
 * done = verde · current = verde con pulso · pending = gris · error = rojo.
 * Reutilizable: auditoría (3 fases) y pipeline (una etapa por herramienta).
 */

const SEG_STYLE: Record<SegState, string> = {
  done: 'bg-emerald-500 text-white',
  current: 'bg-emerald-300 text-emerald-900 animate-pulse dark:bg-emerald-400',
  pending: 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500',
  error: 'bg-red-500 text-white',
}

export function ProgressBar({ segments }: { segments: ProgressSegment[] }) {
  if (segments.length === 0) return null
  return (
    <div className="flex w-full overflow-hidden rounded-md" role="progressbar" aria-label="Progreso">
      {segments.map((s, i) => (
        <div
          key={`${s.label}-${i}`}
          title={`${s.label} — ${s.state}`}
          className={`min-w-0 flex-1 px-2 py-1.5 text-center text-[11px] font-medium transition-colors first:rounded-l-md last:rounded-r-md ${SEG_STYLE[s.state]} ${i > 0 ? 'ml-px' : ''}`}
        >
          <span className="block truncate">{s.label}</span>
        </div>
      ))}
    </div>
  )
}
