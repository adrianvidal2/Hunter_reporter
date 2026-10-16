import Link from 'next/link'
import {
  findingsBySeverityAcrossProjects,
  recentFindings,
  repeatedTemplates,
} from '@/db/correlation'
import { listReconNews } from '@/db/recon-news'

export const dynamic = 'force-dynamic'

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  low: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  info: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
}

/**
 * Correlación cross-proyecto (Tarea 10b): vista READ-ONLY del "grafo
 * pobre" — SQL sobre `findings` (10a) + novedades (9b si existen). Sin
 * infra nueva; los enlaces llevan al proyecto/origen.
 */
export default async function CorrelacionPage() {
  const bySeverity = findingsBySeverityAcrossProjects()
  const recent = recentFindings(20)
  const repeated = repeatedTemplates()
  const news = listReconNews({ limit: 15 })

  const projects = [...new Set([...bySeverity.map((s) => s.project)])].sort()

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Correlación</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Vista read-only cross-proyecto: SQL sobre <code className="font-mono">findings</code> (el “grafo pobre”).
        Nada aquí es fuente de verdad: todo vive en los reportes y el recon de cada proyecto.
      </p>

      {/* Agregado por severidad across programas */}
      <section aria-label="Findings por severidad" className="mt-4 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Findings por severidad across programas</h2>
        {bySeverity.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Sin findings indexados todavía (lanza nuclei y sincroniza en cada proyecto).
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {bySeverity.map((s) => (
              <Link
                key={`${s.project}-${s.severity}`}
                href={`/proyectos/${encodeURIComponent(s.project)}`}
                className={`flex items-center gap-2 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900 ${SEVERITY_STYLE[s.severity] ?? ''}`}
              >
                <span className="font-mono font-semibold uppercase">{s.severity}</span>
                <span className="text-zinc-600 dark:text-zinc-300">{s.project}</span>
                <span className="rounded bg-white/60 px-1.5 font-mono dark:bg-zinc-900/60">{s.count}</span>
              </Link>
            ))}
          </div>
        )}
        {projects.length > 0 ? (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Proyectos con findings: {projects.join(' · ')}
          </p>
        ) : null}
      </section>

      {/* Patrones repetidos entre targets */}
      <section aria-label="Patrones repetidos entre targets" className="mt-4 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Patrones repetidos entre targets</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Mismo template_id en ≥2 programas: patrón reutilizable (misma remediación, misma hunt).
        </p>
        {repeated.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Sin patrones cross-proyecto todavía.
          </p>
        ) : (
          <table className="mt-3 w-full text-left text-xs">
            <thead className="text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-1 pr-3 font-medium">Template</th>
                <th className="py-1 pr-3 font-medium">Máx. sev.</th>
                <th className="py-1 pr-3 font-medium">Hits</th>
                <th className="py-1 font-medium">Proyectos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {repeated.map((r) => (
                <tr key={r.templateId}>
                  <td className="py-1.5 pr-3 font-mono">{r.templateId}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`rounded px-1.5 py-0.5 font-mono uppercase ${SEVERITY_STYLE[r.maxSeverity] ?? ''}`}>
                      {r.maxSeverity}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">{r.occurrences}</td>
                  <td className="py-1.5">
                    <span className="flex flex-wrap gap-1">
                      {r.projects.map((p) => (
                        <Link
                          key={p}
                          href={`/proyectos/${encodeURIComponent(p)}`}
                          className="rounded border border-zinc-300 px-1.5 py-0.5 font-mono hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                        >
                          {p}
                        </Link>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recientes */}
        <section aria-label="Findings recientes" className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">Findings recientes (todos los programas)</h2>
          {recent.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Sin findings.</p>
          ) : (
            <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
              {recent.map((f) => (
                <li key={`${f.project}-${f.id}`} className="flex items-baseline justify-between gap-2 py-1.5 text-xs">
                  <span className="min-w-0">
                    <span className={`mr-1.5 rounded px-1 py-0.5 font-mono uppercase ${SEVERITY_STYLE[f.severity] ?? ''}`}>
                      {f.severity}
                    </span>
                    <span className="font-medium">{f.name}</span>
                    <span className="ml-1 font-mono text-zinc-400">({f.templateId})</span>
                    <span className="block truncate font-mono text-zinc-500 dark:text-zinc-400">@{f.host}</span>
                  </span>
                  <Link
                    href={`/proyectos/${encodeURIComponent(f.project)}`}
                    className="shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 font-mono text-[10px] hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    {f.project}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Novedades (9b si existe) */}
        <section aria-label="Novedades de monitorización" className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">Novedades de monitorización</h2>
          {news.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Sin novedades del scheduler (activa la monitorización en «Novedades»).
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
              {news.map((n) => (
                <li key={`${n.project}-${n.tool}-${n.id}`} className="flex items-baseline justify-between gap-2 py-1.5 text-xs">
                  <span className="min-w-0 truncate font-mono">{n.item}</span>
                  <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
                    {n.tool} · {n.project} · {n.lastSeenAt.toISOString().slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/novedades" className="mt-2 inline-block text-xs underline">
            → gestionar monitorización
          </Link>
        </section>
      </div>
    </div>
  )
}
