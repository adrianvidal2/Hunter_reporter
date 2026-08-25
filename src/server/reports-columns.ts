import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from '@/lib/env'
import { writeAtomic } from '@/core/fs/atomic'
import { resolveSafeAllowMissing } from '@/core/fs/paths'
import { clampWidth, REPORT_COLUMNS } from '@/core/ywh/column-widths'
import type { ReportSortKey } from '@/core/ywh/reports'

/**
 * Persistencia a disco de los anchos de columna de la tabla Reportes:
 * `<root>/.config/reports-columns.json` (config, NO localStorage).
 * Mismo patrón de escritura atómica que la cache de reportes.
 * Las constantes/lógica pura viven en `src/core/ywh/column-widths.ts`.
 */

export const COLUMNS_FILE = '.config/reports-columns.json'

/** Ruta absoluta del fichero de config (resolución segura). */
export function columnsPath(root: string = getEnv().REPORTS_ROOT): string {
  return resolveSafeAllowMissing(COLUMNS_FILE, root)
}

/** Lee los anchos guardados; null si no existe o está corrupto. */
export function readColumnWidths(
  root: string = getEnv().REPORTS_ROOT,
): Partial<Record<ReportSortKey, number>> | null {
  try {
    const abs = columnsPath(root)
    if (!existsSync(abs)) return null
    const raw = JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>
    if (typeof raw !== 'object' || raw === null) return null
    const out: Partial<Record<ReportSortKey, number>> = {}
    for (const key of REPORT_COLUMNS) {
      const v = raw[key]
      if (typeof v === 'number') out[key] = clampWidth(v)
    }
    return out
  } catch {
    return null
  }
}

/** Guarda los anchos (atómico). */
export function writeColumnWidths(
  widths: Partial<Record<ReportSortKey, number>>,
  root: string = getEnv().REPORTS_ROOT,
): void {
  const clean: Record<string, number> = {}
  for (const key of REPORT_COLUMNS) {
    const v = widths[key]
    if (typeof v === 'number') clean[key] = clampWidth(v)
  }
  mkdirSync(path.join(root, '.config'), { recursive: true })
  writeAtomic(COLUMNS_FILE, JSON.stringify(clean, null, 2), { root })
}
