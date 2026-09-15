'use client'

import { useState, useTransition } from 'react'
import { getReconBinStatusAction, saveReconSettingsAction, type ReconBinStatus } from '@/app/escaneos/recon-actions'

/**
 * Sección Recon de Ajustes (diseño aprobado): una ruta POR BINARIO con
 * indicador ✅/❌ (existe y es ejecutable), wordlist por defecto y timeout.
 * Vacío = usar el nombre desnudo (se resuelve con el PATH del servidor).
 */

const inputClass =
  'w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 font-mono text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700'

export function ReconSettingsSection({ initial }: { initial: ReconBinStatus[] }) {
  const [status, setStatus] = useState<ReconBinStatus[]>(initial)
  const [paths, setPaths] = useState<Record<string, string>>(
    Object.fromEntries(initial.map((s) => [s.toolId, s.binPath === s.toolId ? '' : s.binPath])),
  )
  const [feedback, setFeedback] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const save = () =>
    startTransition(async () => {
      const res = await saveReconSettingsAction({ binPaths: paths })
      if (res.ok) {
        setFeedback('Guardado.')
        // refrescar indicadores con lo guardado
        void getReconBinStatusAction().then(setStatus)
      } else {
        setFeedback(res.error ?? 'Error')
      }
    })

  return (
    <section aria-label="Recon" className="mt-10 max-w-2xl">
      <h2 className="text-lg font-semibold tracking-tight">Recon</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Ruta del binario de cada herramienta. Vacío = resolver con el PATH del servidor. El indicador
        dice si la ruta existe y es ejecutable. La app NUNCA eleva privilegios (sudo) ni lanza
        binarios fuera de esta lista.
      </p>

      <div className="mt-3 space-y-1.5">
        {status.map((s) => (
          <div key={s.toolId} className="flex items-center gap-2">
            <span className="w-24 shrink-0 font-mono text-xs" title={s.toolId}>
              {s.label}
            </span>
            <span aria-label={s.ok ? 'binario OK' : 'binario no encontrado'} className={s.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
              {s.ok ? '✅' : '❌'}
            </span>
            <input
              type="text"
              value={paths[s.toolId] ?? ''}
              onChange={(e) => setPaths((prev) => ({ ...prev, [s.toolId]: e.target.value }))}
              placeholder={s.toolId}
              aria-label={`Ruta del binario ${s.label}`}
              className={inputClass}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending ? 'Guardando…' : 'Guardar rutas'}
        </button>
        {feedback ? <span className="text-xs text-zinc-500 dark:text-zinc-400">{feedback}</span> : null}
      </div>
    </section>
  )
}
