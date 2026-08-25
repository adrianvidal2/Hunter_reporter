import type { ReportSortKey } from './reports'

/**
 * Constantes PURAS de anchos de columna para la tabla Reportes (sin fs,
 * importables desde el cliente). La persistencia a disco vive en
 * `src/server/reports-columns.ts`.
 */

/** Orden y claves de las columnas de la tabla. */
export const REPORT_COLUMNS: ReportSortKey[] = [
  'title',
  'program',
  'state',
  'severity',
  'reward',
  'date',
]

/** Anchos por defecto (px). El título es la columna principal, la más ancha. */
export const DEFAULT_COLUMN_WIDTHS: Record<ReportSortKey, number> = {
  title: 320,
  program: 180,
  state: 120,
  severity: 90,
  reward: 110,
  date: 120,
}

/** Límites de ancho (px) para el drag. */
export const MIN_COLUMN_WIDTH = 60
export const MAX_COLUMN_WIDTH = 800

/** Clampa un ancho a los límites. */
export function clampWidth(px: number): number {
  if (Number.isNaN(px)) return MIN_COLUMN_WIDTH
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(px)))
}

/** Devuelve el ancho de una columna con defaults aplicados y clamp. */
export function widthFor(
  state: Partial<Record<ReportSortKey, number>> | null | undefined,
  key: ReportSortKey,
): number {
  const raw = state?.[key] ?? DEFAULT_COLUMN_WIDTHS[key]
  return clampWidth(typeof raw === 'number' ? raw : DEFAULT_COLUMN_WIDTHS[key])
}
