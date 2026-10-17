
/**
 * Helpers de presentación para las vistas de findings (Tarea 14): orden por
 * severidad, estilos accesibles claro/oscuro y modo de vista persistido.
 * PURO: cero I/O, cero React.
 */

export type FindingViewMode = 'tabla' | 'tarjetas'

/** Modo por defecto (lo que se ve la primera vez, sin preferencia guardada). */
export const DEFAULT_FINDING_VIEW: FindingViewMode = 'tabla'

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
}

/** Rank de severidad (critical=0 … info=4); desconocida → 4 (la más baja). */
export function severityRank(severity: string): number {
  return SEVERITY_RANK[severity.trim().toLowerCase()] ?? 4
}

/** Estilo tailwind del badge de severidad (claro/oscuro); desconocida → neutro. */
export function severityStyle(severity: string): string {
  const key = severity.trim().toLowerCase()
  switch (key) {
    case 'critical':
      return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
    case 'high':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300'
    case 'medium':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
    case 'low':
      return 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'
    case 'info':
      return 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
    default:
      return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
  }
}

/** Título legible de la severidad (desconocida → tal cual, saneado). */
export function severityLabel(severity: string): string {
  const key = severity.trim().toLowerCase()
  return SEVERITY_RANK[key] !== undefined ? key : severity.trim() || 'info'
}

export interface SortableFinding {
  severity: string
  host: string
  templateId: string
}

/**
 * Orden por severidad (critical primero) y, a igualdad, por host y luego
 * templateId — empates deterministas para la tabla y las tarjetas. NO muta
 * el array de entrada: devuelve una copia ordenada.
 */
export function sortBySeverity<T extends SortableFinding>(findings: readonly T[]): T[] {
  return [...findings].sort((a, b) => {
    const rank = severityRank(a.severity) - severityRank(b.severity)
    if (rank !== 0) return rank
    if (a.host !== b.host) return a.host.localeCompare(b.host)
    return a.templateId.localeCompare(b.templateId)
  })
}

const VIEW_MODES: FindingViewMode[] = ['tabla', 'tarjetas']

/** Normaliza un modo guardado: inválido/vacío → 'tabla' (default). */
export function normalizeViewMode(raw: string | null | undefined): FindingViewMode {
  const value = raw?.trim().toLowerCase()
  return (VIEW_MODES as string[]).includes(value ?? '') ? (value as FindingViewMode) : DEFAULT_FINDING_VIEW
}

/** Clave de localStorage para la preferencia de vista. */
export const FINDING_VIEW_STORAGE_KEY = 'reporter.findings.view'
