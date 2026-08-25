'use client'

import { useState, useTransition } from 'react'
import { createProjectFromProgramAction } from '@/app/programas/actions'
import { CopyButton } from './copy-button'
import type { Program, Scope } from '@/core/ywh/types'

/**
 * Detalle de programa (9.5): scope in/out y user_agent COPIABLES de un clic
 * (los llevas a Burp/scripts), reward grids, stats y reglas.
 */

const ASSET_COLORS: Record<string, string> = {
  CRITICAL: 'text-red-600 dark:text-red-400',
  HIGH: 'text-orange-600 dark:text-orange-400',
  MEDIUM: 'text-amber-600 dark:text-amber-400',
  LOW: 'text-zinc-500 dark:text-zinc-400',
}

export function scopesToText(scopes: Scope[]): string {
  return scopes.map((s) => s.scope).filter(Boolean).join('\n')
}

function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'amber' | 'green' }) {
  const cls =
    tone === 'amber'
      ? 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300'
      : tone === 'green'
        ? 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300'
        : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300'
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>
  )
}

export function ProgramDetail({ program, existingProject }: { program: Program; existingProject?: string }) {
  const [created, setCreated] = useState<string | null>(existingProject ?? null)
  const [note, setNote] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const createProject = () =>
    startTransition(async () => {
      const res = await createProjectFromProgramAction(program.slug)
      if (res.ok) {
        setCreated(res.projectName!)
        const partes = [
          res.preservedMd ? 'programa.md respetado; nuevo: ' + res.mdPath!.split('/').pop() : 'pentest/programa.md + programa.json',
          res.alreadyExisted ? 'estructura ya existía' : null,
          res.privateProgram ? '⚠️ privado: NDA — no compartas el contenido' : null,
        ].filter(Boolean)
        setNote(partes.join(' · '))
      } else {
        setNote(res.error ?? 'Error')
      }
    })
  const grids: [string, Program['reward_grid_default']][] = [
    ['Critical', program.reward_grid_critical],
    ['High', program.reward_grid_high],
    ['Medium', program.reward_grid_medium],
    ['Low', program.reward_grid_low],
    ['Very low', program.reward_grid_very_low],
  ]
  const hasGrids = grids.some(([, g]) => g != null)

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{program.title || program.slug}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{program.slug}</code>
          <Badge tone={program.public ? 'green' : 'amber'}>
            {program.public ? 'público' : 'privado'}
          </Badge>
          <Badge>{program.type}</Badge>
          {program.bounty ? (
            <Badge tone="green">
              bounty {program.bounty_reward_min}–{program.bounty_reward_max} {program.business_unit?.currency ?? 'EUR'}
            </Badge>
          ) : (
            <Badge>sin bounty</Badge>
          )}
          {program.disabled ? <Badge>disabled</Badge> : null}
          {program.archived ? <Badge>archived</Badge> : null}
          {program.business_unit?.name ? <Badge>{program.business_unit.name}</Badge> : null}
        </div>
      </div>

      {/* Acción: crear proyecto local (9.6, nombre = slug) */}
      <section aria-label="Crear proyecto local">
        {created ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
            <span>✓ Proyecto <code className="font-mono">{created}</code> en tu árbol</span>
            <a href={`/proyectos/${encodeURIComponent(created)}`} className="underline">Abrir →</a>
            {note ? <span className="text-xs text-zinc-500 dark:text-zinc-400">· {note}</span> : null}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={createProject}
              disabled={pending}
              className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {pending ? 'Creando…' : `Crear proyecto «${program.slug}»`}
            </button>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              crea el proyecto + <code className="font-mono">pentest/programa.md</code> y{' '}
              <code className="font-mono">programa.json</code>; tus otras carpetas no se tocan
            </span>
          </div>
        )}
      </section>

      {/* User agent: lo que pones en Burp y scripts */}
      {program.user_agent ? (
        <section aria-label="User-Agent del programa">
          <h3 className="text-sm font-semibold">User-Agent requerido</h3>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-zinc-300 bg-zinc-50 px-3 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950">
              {program.user_agent}
            </code>
            <CopyButton text={program.user_agent} label="Copiar UA" title="Copiar el User-Agent para Burp/scripts" />
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
            <CopyButton
              text={scopesToText(program.scopes)}
              label="Copiar todo el scope"
              title="Copia todos los scopes (uno por línea)"
            />
          ) : null}
        </div>
        {program.scopes.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Sin scopes declarados.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead className="text-xs text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-1 pr-3">Scope</th>
                <th className="py-1 pr-3">Tipo</th>
                <th className="py-1 pr-3">Valor</th>
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
            <CopyButton
              text={program.out_of_scope.join('\n')}
              label="Copiar out-of-scope"
              title="Copia todo el out-of-scope (una entrada por línea)"
            />
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

      {/* Reward grids */}
      {hasGrids ? (
        <section aria-label="Reward grid">
          <h3 className="text-sm font-semibold">Reward grid</h3>
          <table className="mt-2 w-full text-left text-sm">
            <thead className="text-xs text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-1 pr-3">Severidad</th>
                <th className="py-1 pr-3 text-right">Low</th>
                <th className="py-1 pr-3 text-right">Medium</th>
                <th className="py-1 pr-3 text-right">High</th>
                <th className="py-1 text-right">Critical</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {grids.map(([label, g]) =>
                g ? (
                  <tr key={label}>
                    <td className="py-1 pr-3 font-medium">{label}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{g.bounty_low}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{g.bounty_medium}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{g.bounty_high}</td>
                    <td className="py-1 text-right tabular-nums">{g.bounty_critical}</td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        </section>
      ) : null}

      {/* Stats */}
      {program.stats ? (
        <section aria-label="Estadísticas">
          <h3 className="text-sm font-semibold">Estadísticas</h3>
          <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">Reportes</dt>
              <dd className="tabular-nums">{program.stats.total_reports ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">Máx. recompensa</dt>
              <dd className="tabular-nums">{program.stats.max_reward ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">Media recompensa</dt>
              <dd className="tabular-nums">{program.stats.average_reward ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">1ª respuesta (días)</dt>
              <dd className="tabular-nums">{program.stats.average_first_time_response ?? '—'}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {/* Reglas y vulnerabilidades */}
      <details className="rounded-md border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Reglas del programa</summary>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-3 pb-3 text-sm text-zinc-600 dark:text-zinc-300">
          {program.rules || '(sin reglas)'}
        </pre>
      </details>
      {program.qualifying_vulnerability.length > 0 ? (
        <details className="rounded-md border border-zinc-200 dark:border-zinc-800">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            Vulnerabilidades cualificables ({program.qualifying_vulnerability.length})
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
            No cualificables ({program.non_qualifying_vulnerability.length})
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
