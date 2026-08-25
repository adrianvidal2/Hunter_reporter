import { z } from 'zod'
import { paginationParser } from './types'

/**
 * Reportes propios del hunter (`GET /user/reports`, verificado en 9.1/25/8).
 * Ruta interna (no documentada en el OpenAPI); forma real en
 * docs/fixtures/ywh/user-reports-item.json.
 *
 * Tolerancia igual que el resto: campos desconocidos se ignoran (strip) y
 * campos conocidos con `.catch(default)` para no romper ante tipos raros.
 */

const reportStatusParser = z
  .object({
    workflow_state: z.string().catch(''),
  })
  .nullish()
  .catch(null)

const cvssParser = z
  .object({
    criticity: z.enum(['N', 'L', 'M', 'H', 'C', '']).catch(''),
    score: z.number().nullish(),
    vector: z.string().catch(''),
    version: z.string().catch(''),
  })
  .nullish()
  .catch(null)

const reportProgramParser = z
  .object({
    title: z.string().catch(''),
    slug: z.string().catch(''),
    public: z.boolean().catch(true),
    bounty: z.boolean().catch(false),
  })
  .nullish()
  .catch(null)

/** Un item de la lista "mis reportes". */
export const userReportParser = z.object({
  id: z.number().int().catch(0),
  local_id: z.string().catch(''),
  title: z.string().catch(''),
  scope: z.string().catch(''),
  program: reportProgramParser,
  status: reportStatusParser,
  cvss: cvssParser,
  hunter: z.object({ username: z.string().catch('') }).nullish().catch(null),
  reward: z.number().nullish(),
  cost_credits: z.number().nullish(),
  currency: z.string().nullish(),
  marked_as: z.string().catch(''),
  collaborative: z.boolean().catch(false),
  created_at: z.string().nullish(),
  changed_at: z.string().nullish(),
  ask_for_fix_verification_status: z.string().catch(''),
})

export type UserReport = z.infer<typeof userReportParser>

export const userReportPageParser = z.object({
  items: z.array(userReportParser),
  pagination: paginationParser,
})

export type UserReportPage = z.infer<typeof userReportPageParser>

/** Resultado completo tras recorrer todas las páginas. */
export interface MyReportsResult {
  items: UserReport[]
  /** Estadísticas del recorrido. */
  stats: { pages: number; items: number; elapsedMs: number }
}

/** Etiquetas legibles de los estados de workflow (para badges y filtro). */
export const REPORT_STATE_LABELS: Record<string, string> = {
  new: 'Nuevo',
  under_review: 'En revisión',
  triaged: 'Triado',
  accepted: 'Aceptado',
  resolved: 'Resuelto',
  informative: 'Informativo',
  duplicated: 'Duplicado',
  duplicate: 'Duplicado',
  closed: 'Cerrado',
  rejected: 'Rechazado',
  rtfs: 'RTFS',
  out_of_scope: 'Fuera de scope',
  invalid: 'Inválido',
}

export function reportStateLabel(state: string): string {
  return REPORT_STATE_LABELS[state] ?? state
}

/** Prioridad explícita de estado para el ORDEN INICIAL por defecto.
 *  (no alfabético; claves de workflow_state reales). Estados no listados
 *  van al final (prioridad alta). */
export const STATE_ORDER: string[] = [
  'under_review',
  'accepted',
  'resolved',
  'informative',
  'rtfs',
  'out_of_scope',
  'duplicate',
  'duplicated',
  'invalid',
]

export function statePriority(state: string): number {
  const i = STATE_ORDER.indexOf(state)
  return i === -1 ? STATE_ORDER.length : i
}

/** Orden INICIAL por defecto (antes de que el usuario toque la cabecera):
 *  agrupa por estado según STATE_ORDER y, dentro de cada grupo, ordena por
 *  fecha DESCENDENTE (más reciente arriba). No muta el array. */
export function defaultSortReports(items: UserReport[]): UserReport[] {
  return [...items].sort((a, b) => {
    const pa = statePriority(a.status?.workflow_state ?? '')
    const pb = statePriority(b.status?.workflow_state ?? '')
    if (pa !== pb) return pa - pb
    const ta = a.created_at ? Date.parse(a.created_at) : -Infinity
    const tb = b.created_at ? Date.parse(b.created_at) : -Infinity
    return tb - ta // fecha desc (más reciente primero)
  })
}

/** Opciones de estado DERIVADAS de los estados presentes en los items
 *  (nunca una lista fija). Orden: la primera aparición en la cache. */
/** Opciones de estado DERIVADAS de los estados presentes en los items
 *  (nunca una lista fija), ORDENADAS por la MISMA prioridad que el orden
 *  inicial de la tabla (STATE_ORDER). Estados no listados, al final
 *  (empate por su orden de aparición). */
export function reportStateOptions(items: UserReport[]): { value: string; label: string }[] {
  const seen: string[] = []
  for (const r of items) {
    const s = r.status?.workflow_state ?? ''
    if (s !== '' && !seen.includes(s)) seen.push(s)
  }
  return seen
    .sort((a, b) => statePriority(a) - statePriority(b))
    .map((s) => ({ value: s, label: reportStateLabel(s) }))
}

/** Filtra los reportes por estado ('' → todos). */
export function filterReportsByState(items: UserReport[], state: string): UserReport[] {
  if (state === '') return items
  return items.filter((r) => (r.status?.workflow_state ?? '') === state)
}

/** Columnas ordenables de la tabla (clic en cabecera). */
export type ReportSortKey =
  | 'title'
  | 'program'
  | 'state'
  | 'severity'
  | 'reward'
  | 'date'

export type SortDir = 'asc' | 'desc'

/** Ordena los reportes por una columna (asc/desc). No muta el array. */
export function sortReports(items: UserReport[], key: ReportSortKey, dir: SortDir): UserReport[] {
  const sorted = [...items]
  const dirSign = dir === 'asc' ? 1 : -1

  const byString = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' })

  sorted.sort((a, b) => {
    switch (key) {
      case 'title': {
        const x = (a.title || a.local_id).toLocaleLowerCase()
        const y = (b.title || b.local_id).toLocaleLowerCase()
        return byString(x, y) * dirSign
      }
      case 'program': {
        const x = (a.program?.title || a.program?.slug || '').toLocaleLowerCase()
        const y = (b.program?.title || b.program?.slug || '').toLocaleLowerCase()
        return byString(x, y) * dirSign
      }
      case 'state': {
        const x = a.status?.workflow_state ?? ''
        const y = b.status?.workflow_state ?? ''
        return byString(x, y) * dirSign
      }
      case 'severity': {
        // Numérico (cvss.score); null se trata como el mayor (va al final en asc)
        const x = a.cvss?.score ?? -1
        const y = b.cvss?.score ?? -1
        return (x - y) * dirSign
      }
      case 'reward': {
        // Importe numérico (reward en céntimos); null → -1
        const x = a.reward ?? -1
        const y = b.reward ?? -1
        return (x - y) * dirSign
      }
      case 'date': {
        const x = a.created_at ? new Date(a.created_at).getTime() : -Infinity
        const y = b.created_at ? new Date(b.created_at).getTime() : -Infinity
        return (x - y) * dirSign
      }
      default:
        return 0
    }
  })
  return sorted
}

/** URL directa del reporte en la web de YWH (sin API). */
export function reportWebUrl(report: Pick<UserReport, 'id'>): string {
  return `https://yeswehack.com/report/${report.id}`
}

/**
 * Formatea el importe de recompensa. La API manda `reward` en CÉNTIMOS:
 * se divide por 100 AQUÍ (punto de lectura del dato), no en el render.
 * Formato: importe + signo de la moneda, separador de miles, sin decimales
 * ni saltos de línea (p. ej. "750 €", "3.000 €"). null → "—".
 */
export function formatReward(
  rewardCents: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (rewardCents == null) return '—'
  const cur = currency?.trim() || 'EUR'
  try {
    const formatted = new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
      useGrouping: true,
    }).format(rewardCents / 100)
    // Normalizar el NBSP que Intl pone entre importe y símbolo a un espacio.
    return formatted.replace(/\u00a0/g, ' ').trim()
  } catch {
    return `${rewardCents / 100} ${cur}`
  }
}
