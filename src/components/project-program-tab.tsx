'use client'

import { useState } from 'react'
import { CopyButton } from './copy-button'
import { scopesToText } from './program-detail'
import { LaunchWizard } from './launch-wizard'
import { currencySymbol, rewardRows, type CvssLevel } from '@/core/ywh/reward'
import type { PromptMeta } from '@/core/prompts/prompts'
import type { Program } from '@/core/ywh/types'

/**
 * Pestaña "Programa" de la vista de proyecto (SOLO LECTURA).
 * Lee del fichero local (fixture; en el futuro programa.json del proyecto).
 * Sin llamadas a la API: todo se renderiza a partir de `program`.
 */

const ASSET_COLORS: Record<string, string> = {
  CRITICAL: 'text-red-600 dark:text-red-400',
  HIGH: 'text-orange-600 dark:text-orange-400',
  MEDIUM: 'text-amber-600 dark:text-amber-400',
  LOW: 'text-zinc-500 dark:text-zinc-400',
}

/** Badge de importe por nivel CVSS (misma paleta de severidad del scope). */
const CVSS_BADGE: Record<CvssLevel, string> = {
  Low: 'border-sky-300 text-sky-600 dark:border-sky-800 dark:text-sky-400',
  Medium: 'border-amber-300 text-amber-600 dark:border-amber-800 dark:text-amber-400',
  High: 'border-orange-300 text-orange-600 dark:border-orange-800 dark:text-orange-400',
  Critical: 'border-red-300 text-red-600 dark:border-red-800 dark:text-red-400',
}

export function ProjectProgramTab({
  program,
  project,
  prompts = [],
}: {
  program: Program | null
  project: string
  prompts?: PromptMeta[]
}) {
  const [wizardOpen, setWizardOpen] = useState(false)

  if (!program) {
    return (
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Sin datos del programa.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{program.title || program.slug}</h2>
          <p className="mt-1 font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {program.slug}
            {program.business_unit?.name ? ` · ${program.business_unit.name}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Lanzar
        </button>
      </div>

      {wizardOpen ? (
        <LaunchWizard
          project={project}
          program={program}
          prompts={prompts}
          onClose={() => setWizardOpen(false)}
        />
      ) : null}

      {/* User-Agent obligatorio */}
      {program.user_agent ? (
        <section aria-label="User-Agent del programa">
          <h3 className="text-sm font-semibold">User-Agent requerido</h3>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-zinc-300 bg-zinc-50 px-3 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950">
              {program.user_agent}
            </code>
            <CopyButton text={program.user_agent} label="Copiar UA" title="Copiar el User-Agent" />
          </div>
        </section>
      ) : null}

      {/* Scope IN */}
      <section aria-label="Scope in">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            Scope in <span className="text-zinc-400">({program.scopes.length})</span>
          </h3>
          {program.scopes.length > 0 ? (
            <CopyButton text={scopesToText(program.scopes)} label="Copiar scope" title="Copia todos los scopes (uno por línea)" />
          ) : null}
        </div>
        {program.scopes.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Sin scopes declarados.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead className="text-xs text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-1 pr-3">Scope</th>
                <th className="py-1 pr-3">Tipo de asset</th>
                <th className="py-1 pr-3">Criticidad</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {program.scopes.map((s, i) => (
                <tr key={`${s.scope}-${i}`}>
                  <td className="max-w-0 truncate py-1.5 pr-3 font-mono text-xs" title={s.scope}>
                    {s.scope}
                  </td>
                  <td className="py-1.5 pr-3 text-xs text-zinc-500 dark:text-zinc-400">
                    {s.scope_type_name ?? s.scope_type}
                  </td>
                  <td className={`py-1.5 pr-3 text-xs font-medium ${ASSET_COLORS[s.asset_value] ?? ''}`}>
                    {s.asset_value}
                  </td>
                  <td className="py-1.5 text-right">
                    <CopyButton text={s.scope} label="⧉" compact title={`Copiar ${s.scope}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Scope OUT */}
      {program.out_of_scope.length > 0 ? (
        <section aria-label="Scope out">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              Out of scope <span className="text-zinc-400">({program.out_of_scope.length})</span>
            </h3>
            <CopyButton text={program.out_of_scope.join('\n')} label="Copiar out-of-scope" title="Copia todo el out-of-scope" />
          </div>
          <ul className="mt-2 space-y-1.5">
            {program.out_of_scope.map((o, i) => (
              <li key={i} className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-zinc-600 dark:text-zinc-300">{o}</span>
                <CopyButton text={o} label="⧉" compact title={`Copiar: ${o.slice(0, 80)}`} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Reward grid: badges de importe por nivel CVSS (fila por asset value) */}
      {(() => {
        const rows = rewardRows(program)
        if (rows.length === 0) return null
        const sym = currencySymbol(program.business_unit?.currency)
        return (
          <section aria-label="Reward">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">Reward</h3>
                <div className="mt-2 space-y-2">
                  {rows.map(({ value, amounts }) => (
                    <div key={value || 'default'} className="flex flex-wrap items-center gap-2">
                      {value ? (
                        <span className="mr-1 text-xs uppercase tracking-wide text-zinc-400">{value}</span>
                      ) : null}
                      {Object.entries(amounts).map(([level, amount]) => (
                        <span
                          key={level}
                          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${CVSS_BADGE[level as CvssLevel]}`}
                        >
                          {level} {sym}{amount}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )
      })()}

      {/* Reglas */}
      <details className="rounded-md border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Reglas del programa</summary>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-3 pb-3 text-sm text-zinc-600 dark:text-zinc-300">
          {program.rules || '(sin reglas)'}
        </pre>
      </details>

      {/* Vulnerabilidades aceptadas / rechazadas */}
      {program.qualifying_vulnerability.length > 0 ? (
        <details className="rounded-md border border-zinc-200 dark:border-zinc-800">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            Vulnerabilidades aceptadas ({program.qualifying_vulnerability.length})
          </summary>
          <ul className="list-disc px-7 py-2 text-sm text-zinc-600 dark:text-zinc-300">
            {program.qualifying_vulnerability.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {program.non_qualifying_vulnerability.length > 0 ? (
        <details className="rounded-md border border-zinc-200 dark:border-zinc-800">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            Vulnerabilidades no aceptadas ({program.non_qualifying_vulnerability.length})
          </summary>
          <ul className="list-disc px-7 py-2 text-sm text-zinc-600 dark:text-zinc-300">
            {program.non_qualifying_vulnerability.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
