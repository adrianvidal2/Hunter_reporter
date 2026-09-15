'use client'

import { useState, useTransition } from 'react'
import { createProjectFromIntigritiProgramAction, createProjectFromProgramAction } from '@/app/programas/actions'
import { CopyButton } from './copy-button'
import type { NeutralProgramDetail, NeutralScope, PlatformId } from '@/core/programs/types'

/**
 * Detalle de programa (9.5): scope in/out y user_agent COPIABLES de un clic
 * (los llevas a Burp/scripts), reward grids, stats y reglas.
 * Consume el modelo neutro (paso 1 multiplataforma); el raw de la plataforma
 * viaja en `program.raw` para las vistas específicas.
 */

const ASSET_COLORS: Record<string, string> = {
  CRITICAL: 'text-red-600 dark:text-red-400',
  HIGH: 'text-orange-600 dark:text-orange-400',
  MEDIUM: 'text-amber-600 dark:text-amber-400',
  LOW: 'text-zinc-500 dark:text-zinc-400',
}

export function scopesToText(scopes: NeutralScope[]): string {
  return scopes.map((s) => s.target).filter(Boolean).join('\n')
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

export function ProgramDetail({
  program,
  existingProject,
  platform = 'yeswehack',
}: {
  program: NeutralProgramDetail
  existingProject?: string
  platform?: PlatformId
}) {
  const [created, setCreated] = useState<string | null>(existingProject ?? null)
  const [note, setNote] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const createProject = () =>
    startTransition(async () => {
      const res =
        platform === 'intigriti'
          ? await createProjectFromIntigritiProgramAction(program.id || program.slug)
          : await createProjectFromProgramAction(program.slug)
      if (res.ok) {
        setCreated(res.projectName!)
        const pendingSync = 'pendingSync' in res && res.pendingSync
        const syncMsg = (res as { syncError?: string }).syncError ?? null
        if (pendingSync) {
          setSyncError(syncMsg ?? 'Sesión caducada, renueva el token en Ajustes.')
          setNote('Proyecto creado pero PENDIENTE DE SINCRONIZAR: programa.json no se pudo rellenar.')
        } else {
          setSyncError(null)
          const partes = [
            res.alreadyExisted ? 'estructura ya existía' : null,
            res.privateProgram ? '⚠️ privado: NDA — no compartas el contenido' : null,
          ].filter(Boolean)
          setNote(partes.join(' · ') || 'programa.json rellenado con el detalle de la API.')
        }
      } else {
        setNote(res.error ?? 'Error')
      }
    })
  const grids = program.rewardGrids
  const hasGrids = grids.length > 0

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{program.title || program.slug}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{program.slug}</code>
          <Badge tone={program.isPublic ? 'green' : 'amber'}>
            {program.isPublic ? 'público' : 'privado'}
          </Badge>
          <Badge>{program.type}</Badge>
          {program.hasBounty ? (
            <Badge tone="green">
              bounty {program.bountyMin}–{program.bountyMax} {program.businessUnit?.currency ?? 'EUR'}
            </Badge>
          ) : (
            <Badge>sin bounty</Badge>
          )}
          {program.disabled ? <Badge>disabled</Badge> : null}
          {program.archived ? <Badge>archived</Badge> : null}
          {program.businessUnit?.name ? <Badge>{program.businessUnit.name}</Badge> : null}
        </div>
      </div>

      {/* Acción: crear proyecto local (9.6, nombre = slug) */}
      <section aria-label="Crear proyecto local">
        {created ? (
          <div className="space-y-2">
            <p className="flex flex-wrap items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
              <span>✓ Proyecto <code className="font-mono">{created}</code> en tu árbol</span>
              <a href={`/proyectos/${encodeURIComponent(created)}`} className="underline">Abrir →</a>
              {note ? <span className="text-xs text-zinc-500 dark:text-zinc-400">· {note}</span> : null}
            </p>
            {syncError ? (
              <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                {syncError}
              </p>
            ) : null}
          </div>
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
      {program.userAgent ? (
        <section aria-label="User-Agent del programa">
          <h3 className="text-sm font-semibold">User-Agent requerido</h3>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-zinc-300 bg-zinc-50 px-3 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950">
              {program.userAgent}
            </code>
            <CopyButton text={program.userAgent} label="Copiar UA" title="Copiar el User-Agent para Burp/scripts" />
          </div>
        </section>
      ) : null}

      {/* Scope IN */}
      <section aria-label="Scope in">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            Scope in <span className="text-zinc-400">({program.inScope.length})</span>
          </h3>
          {program.inScope.length > 0 ? (
            <CopyButton
              text={scopesToText(program.inScope)}
              label="Copiar todo el scope"
              title="Copia todos los scopes (uno por línea)"
            />
          ) : null}
        </div>
        {program.inScope.length === 0 ? (
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
              {program.inScope.map((s, i) => (
                <tr key={`${s.target}-${i}`}>
                  <td className="max-w-0 truncate py-1.5 pr-3 font-mono text-xs" title={s.target}>
                    {s.target}
                  </td>
                  <td className="py-1.5 pr-3 text-xs text-zinc-500 dark:text-zinc-400">
                    {s.typeLabel ?? s.type}
                  </td>
                  <td className={`py-1.5 pr-3 text-xs font-medium ${ASSET_COLORS[s.assetValue] ?? ''}`}>
                    {s.assetValue}
                  </td>
                  <td className="py-1.5 text-right">
                    <CopyButton text={s.target} label="⧉" compact title={`Copiar ${s.target}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Scope OUT */}
      {program.outOfScope.length > 0 ? (
        <section aria-label="Scope out">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              Out of scope <span className="text-zinc-400">({program.outOfScope.length})</span>
            </h3>
            <CopyButton
              text={program.outOfScope.join('\n')}
              label="Copiar out-of-scope"
              title="Copia todo el out-of-scope (una entrada por línea)"
            />
          </div>
          <ul className="mt-2 space-y-1.5">
            {program.outOfScope.map((o, i) => (
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
              {grids.map((g) => (
                  <tr key={g.label}>
                    <td className="py-1 pr-3 font-medium">{g.label}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{g.amounts.low}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{g.amounts.medium}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{g.amounts.high}</td>
                    <td className="py-1 text-right tabular-nums">{g.amounts.critical}</td>
                  </tr>
              ))}
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
              <dd className="tabular-nums">{program.stats.totalReports ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">Máx. recompensa</dt>
              <dd className="tabular-nums">{program.stats.maxReward ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">Media recompensa</dt>
              <dd className="tabular-nums">{program.stats.averageReward ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">1ª respuesta (días)</dt>
              <dd className="tabular-nums">{program.stats.averageFirstResponseDays ?? '—'}</dd>
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
      {program.qualifying.length > 0 ? (
        <details className="rounded-md border border-zinc-200 dark:border-zinc-800">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            Vulnerabilidades cualificables ({program.qualifying.length})
          </summary>
          <ul className="list-disc px-7 py-2 text-sm text-zinc-600 dark:text-zinc-300">
            {program.qualifying.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {program.nonQualifying.length > 0 ? (
        <details className="rounded-md border border-zinc-200 dark:border-zinc-800">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            No cualificables ({program.nonQualifying.length})
          </summary>
          <ul className="list-disc px-7 py-2 text-sm text-zinc-600 dark:text-zinc-300">
            {program.nonQualifying.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
