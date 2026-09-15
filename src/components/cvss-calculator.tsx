'use client'

import { useMemo, useState } from 'react'
import { computeCvss31, parseCvss31Vector, CVSS_METRIC_KEYS, type CvssMetricKey, type CvssMetrics, type CvssSeverity } from '@/core/cvss/cvss31'
import { CopyButton } from './copy-button'

/**
 * Calculadora CVSS 3.1 (Base Score) estilo NIST: una fila de botones por
 * métrica, score y vector en vivo. Funciona embebida (con onAccept, p. ej.
 * desde el panel de front-matter) o como página propia (sin él).
 */

const METRIC_ROWS: { key: CvssMetricKey; label: string; title: string; options: { value: string; label: string }[] }[] = [
  {
    key: 'AV', label: 'AV', title: 'Attack Vector',
    options: [
      { value: 'N', label: 'Network' },
      { value: 'A', label: 'Adjacent' },
      { value: 'L', label: 'Local' },
      { value: 'P', label: 'Physical' },
    ],
  },
  {
    key: 'AC', label: 'AC', title: 'Attack Complexity',
    options: [
      { value: 'L', label: 'Low' },
      { value: 'H', label: 'High' },
    ],
  },
  {
    key: 'PR', label: 'PR', title: 'Privileges Required',
    options: [
      { value: 'N', label: 'None' },
      { value: 'L', label: 'Low' },
      { value: 'H', label: 'High' },
    ],
  },
  {
    key: 'UI', label: 'UI', title: 'User Interaction',
    options: [
      { value: 'N', label: 'None' },
      { value: 'R', label: 'Required' },
    ],
  },
  {
    key: 'S', label: 'S', title: 'Scope',
    options: [
      { value: 'U', label: 'Unchanged' },
      { value: 'C', label: 'Changed' },
    ],
  },
  {
    key: 'C', label: 'C', title: 'Confidentiality',
    options: [
      { value: 'N', label: 'None' },
      { value: 'L', label: 'Low' },
      { value: 'H', label: 'High' },
    ],
  },
  {
    key: 'I', label: 'I', title: 'Integrity',
    options: [
      { value: 'N', label: 'None' },
      { value: 'L', label: 'Low' },
      { value: 'H', label: 'High' },
    ],
  },
  {
    key: 'A', label: 'A', title: 'Availability',
    options: [
      { value: 'N', label: 'None' },
      { value: 'L', label: 'Low' },
      { value: 'H', label: 'High' },
    ],
  },
]

const SEVERITY_STYLE: Record<CvssSeverity, string> = {
  None: 'text-zinc-500 dark:text-zinc-400',
  Low: 'text-sky-600 dark:text-sky-400',
  Medium: 'text-amber-600 dark:text-amber-400',
  High: 'text-orange-600 dark:text-orange-400',
  Critical: 'text-red-600 dark:text-red-400',
}

const btn = (selected: boolean) =>
  `rounded-md border px-3 py-1.5 text-sm transition-colors ${
    selected
      ? 'border-zinc-900 bg-zinc-900 font-medium text-zinc-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
      : 'border-zinc-300 bg-transparent hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900'
  }`

export function CvssCalculator({
  initialVector,
  onAccept,
  onClose,
}: {
  /** Vector preexistente → métricas preseleccionadas (parser inverso). */
  initialVector?: string
  /** Presente → modo embebido: botón Aceptar que entrega vector+score. */
  onAccept?: (vector: string, score: number) => void
  onClose?: () => void
}) {
  const [metrics, setMetrics] = useState<Partial<CvssMetrics>>(() => {
    if (!initialVector) return {}
    try {
      return parseCvss31Vector(initialVector.trim())
    } catch {
      return {} // vector inválido/antiguo: se parte de cero
    }
  })

  const complete = CVSS_METRIC_KEYS.every((k) => metrics[k] !== undefined)
  const result = useMemo(
    () => (complete ? computeCvss31(metrics as CvssMetrics) : null),
    [complete, metrics],
  )

  const pick = (key: CvssMetricKey, value: string) =>
    setMetrics((prev) => ({ ...prev, [key]: value }))

  return (
    <div aria-label="Calculadora CVSS 3.1">
      {/* Filas de métricas */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {METRIC_ROWS.map(({ key, label, title, options }) => (
          <fieldset key={key} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <legend className="px-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400" title={title}>
              {label} · {title}
            </legend>
            <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label={`Métrica ${title}`}>
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={metrics[key] === o.value}
                  onClick={() => pick(key, o.value)}
                  className={btn(metrics[key] === o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      {/* Resultado en vivo */}
      <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
        {result ? (
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="flex items-baseline gap-3">
              <span className="text-4xl font-bold tabular-nums tracking-tight">{result.score.toFixed(1)}</span>
              <span className={`text-sm font-semibold ${SEVERITY_STYLE[result.severity]}`}>{result.severity}</span>
            </p>
            <p className="flex min-w-0 items-center gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-600 dark:text-zinc-300" title={result.vector}>
                {result.vector}
              </code>
              <CopyButton text={result.vector} label="Copiar vector" />
            </p>
          </div>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Elige un valor para cada métrica: faltan{' '}
            {CVSS_METRIC_KEYS.filter((k) => metrics[k] === undefined).join(', ') || '—'}.
          </p>
        )}
      </div>

      {/* Acciones */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setMetrics({})}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Limpiar
        </button>
        {onAccept ? (
          <div className="flex gap-2">
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Cancelar
              </button>
            ) : null}
            <button
              type="button"
              disabled={!result}
              onClick={() => {
                if (result) onAccept(result.vector, result.score)
              }}
              className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Aceptar
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
