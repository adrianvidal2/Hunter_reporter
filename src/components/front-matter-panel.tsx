'use client'

import type { MetaField, MetaValues } from '@/core/reports/frontmatter'

/**
 * Panel de front-matter (paso 4.10): título, severidad, CVSS y estado en
 * campos aparte del cuerpo. Editar aquí reescribe quirúrgicamente el
 * bloque YAML del documento (conservando formato) y programa el autoguardado.
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
  onChange: (field: MetaField, value: string) => void
}) {
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
          onChange={(e) => onChange('title', e.target.value)}
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
          onChange={(e) => onChange('severity', e.target.value)}
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

      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          CVSS
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={values.cvss ?? ''}
          onChange={(e) => onChange('cvss', e.target.value)}
          placeholder="p. ej. 8.6"
          className={inputClass}
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Estado
        </span>
        <select
          value={values.state ?? ''}
          onChange={(e) => onChange('state', e.target.value)}
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
    </section>
  )
}
