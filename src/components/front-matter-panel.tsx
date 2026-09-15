'use client'

import { useState } from 'react'
import type { MetaValues } from '@/core/reports/frontmatter'
import { CvssCalculator } from './cvss-calculator'

/**
 * Panel de front-matter (paso 4.10): título, severidad, CVSS y estado en
 * campos aparte del cuerpo. Editar aquí reescribe quirúrgicamente el
 * bloque YAML del documento (conservando formato) y programa el autoguardado.
 * Pulsando el campo CVSS se abre la calculadora 3.1, que rellena el score
 * y el vector al aceptar.
 */

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'] as const
const STATES = ['draft', 'ready', 'submitted', 'resolved', 'discarded'] as const

const inputClass =
  'w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700'

export function FrontMatterPanel({
  values,
  onChange,
}: {
  values: MetaValues
  /** Lote de cambios: una llamada = una edición quirúrgica del YAML. */
  onChange: (changes: MetaValues) => void
}) {
  const [calcOpen, setCalcOpen] = useState(false)
  // si el campo "cvss" contiene directamente un vector (informes viejos), sirve de preselección
  const initialVector = values.cvss_vector ?? (values.cvss?.startsWith('CVSS:3.1/') ? values.cvss : undefined)

  return (
    <section
      aria-label="Metadatos del informe"
      className="mt-4 grid grid-cols-1 gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:grid-cols-2 lg:grid-cols-4"
    >
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Título
        </span>
        <input
          type="text"
          value={values.title ?? ''}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Título del reporte"
          className={inputClass}
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Severidad
        </span>
        <select
          value={values.severity ?? ''}
          onChange={(e) => onChange({ severity: e.target.value })}
          className={`${inputClass} dark:[color-scheme:dark]`}
        >
          <option value="">—</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <div className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          CVSS
        </span>
        <div className="flex gap-1.5">
          <input
            type="text"
            inputMode="decimal"
            value={values.cvss ?? ''}
            onChange={(e) => onChange({ cvss: e.target.value })}
            onFocus={() => setCalcOpen(true)}
            placeholder="p. ej. 8.6 — pulsa para calcular"
            aria-label="CVSS (pulsar abre la calculadora)"
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => setCalcOpen(true)}
            aria-label="Abrir calculadora CVSS"
            title="Abrir calculadora CVSS 3.1"
            className="shrink-0 rounded-md border border-zinc-300 px-2.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            🧮
          </button>
        </div>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Estado
        </span>
        <select
          value={values.state ?? ''}
          onChange={(e) => onChange({ state: e.target.value })}
          className={`${inputClass} dark:[color-scheme:dark]`}
        >
          <option value="">—</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      {/* Modal de la calculadora CVSS (precarga el vector existente) */}
      {calcOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4 pt-16"
          onClick={() => setCalcOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Calculadora CVSS 3.1"
        >
          <div
            className="w-full max-w-2xl rounded-lg border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">Calculadora CVSS 3.1</h2>
              <button
                type="button"
                onClick={() => setCalcOpen(false)}
                aria-label="Cerrar calculadora"
                className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              >
                ✕
              </button>
            </div>
            <CvssCalculator
              initialVector={initialVector}
              onAccept={(vector, score) => {
                // UNA sola edición del YAML con ambos campos: dos onChange
                // seguidos compiten sobre el mismo `content` (stale) y se
                // pierde el score.
                onChange({ cvss: score.toFixed(1), cvss_vector: vector })
                setCalcOpen(false)
              }}
              onClose={() => setCalcOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </section>
  )
}
