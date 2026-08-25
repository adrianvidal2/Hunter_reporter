import { listLlmRuns } from '@/db/runs'

/** Tabla de las últimas ejecuciones LLM (8.9). Server Component puro. */

function formatCost(usd: number | null, basis: string | null): string {
  if (usd === null) return '—'
  const usdStr = usd >= 0.01 ? usd.toFixed(4) : usd.toFixed(6)
  return `$${usdStr}`
}

function formatTs(ms: number): string {
  return new Date(ms).toLocaleString('es', { dateStyle: 'short', timeStyle: 'medium' })
}

export function LlmRunsLog() {
  const runs = listLlmRuns(50)

  return (
    <section aria-label="Registro de ejecuciones LLM" className="mt-10 max-w-4xl">
      <h2 className="text-lg font-semibold tracking-tight">Registro de ejecuciones</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Últimas {runs.length} ejecuciones. El coste es una estimación (precios públicos por
        millón de tokens); «—» = no deducible para ese modelo. Pasa el ratón por el coste para
        ver el criterio.
      </p>

      {runs.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          Todavía no hay ejecuciones registradas.
        </p>
      ) : (
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="py-1 pr-3">Fecha</th>
              <th className="py-1 pr-3">Modelo</th>
              <th className="py-1 pr-3">Fichero</th>
              <th className="py-1 pr-3 text-right">Tokens (in→out)</th>
              <th className="py-1 pr-3 text-right">Duración</th>
              <th className="py-1 pr-3 text-right">Coste est.</th>
              <th className="py-1">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {runs.map((r) => (
              <tr key={r.id} className={r.status !== 'ok' ? 'text-zinc-400' : ''}>
                <td className="py-1 pr-3 whitespace-nowrap">{formatTs(r.ts.getTime())}</td>
                <td className="py-1 pr-3 font-mono text-xs">{r.model}</td>
                <td className="max-w-40 truncate py-1 pr-3 font-mono text-xs" title={r.path ?? ''}>
                  {r.path?.split('/').pop() ?? '—'}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {r.promptTokens !== null ? `${r.promptTokens}→${r.completionTokens ?? '?'}` : '—'}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {r.attempts > 1 ? `${r.attempts}× ` : ''}
                  {(r.latencyMs / 1000).toFixed(1)}s
                </td>
                <td
                  className="py-1 pr-3 text-right tabular-nums"
                  title={r.costBasis ?? 'coste no deducible para este modelo'}
                >
                  {formatCost(r.costUsd, r.costBasis)}
                </td>
                <td className="py-1">
                  {r.status === 'ok' ? (
                    <span className="text-emerald-600 dark:text-emerald-400">ok</span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400" title={r.error ?? ''}>
                      {r.status}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
