import type { Program } from './types'

/**
 * Reward grid de un programa (interpretación CORRECTA de YesWeHack):
 * cada campo `reward_grid_<asset_value>` es la tabla de importes según el
 * nivel CVSS del hallazgo que aplica a un asset con ese value. NO son filas
 * de severidad: `bounty_low/medium/high/critical` son los importes por
 * severidad CVSS dentro del grid de UN asset value.
 *
 * Se devuelve una entrada por cada asset value distinto que tenga un grid
 * con importes. Si un asset value no tiene grid propio, cae al default
 * (solo si difiere); si el default es todo null/ceros, se omite.
 */

export const CVSS_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const
export type CvssLevel = (typeof CVSS_LEVELS)[number]

export interface RewardRow {
  /** Asset value (p. ej. "HIGH"). Vacío si se usó el default. */
  value: string
  /** Importes por nivel CVSS (se omiten null/0 en el render). */
  amounts: Partial<Record<CvssLevel, number>>
}

type Grid = NonNullable<Program['reward_grid_high']>

const GRID_BY_VALUE: Record<string, (p: Program) => Grid | null | undefined> = {
  CRITICAL: (p) => p.reward_grid_critical,
  HIGH: (p) => p.reward_grid_high,
  MEDIUM: (p) => p.reward_grid_medium,
  LOW: (p) => p.reward_grid_low,
  'VERY LOW': (p) => p.reward_grid_very_low,
}

const toAmounts = (g: Grid | null | undefined): Partial<Record<CvssLevel, number>> => {
  const rec = g as unknown as Record<string, number | null | undefined> | null | undefined
  const key: Record<CvssLevel, string> = {
    Low: 'bounty_low',
    Medium: 'bounty_medium',
    High: 'bounty_high',
    Critical: 'bounty_critical',
  }
  const out: Partial<Record<CvssLevel, number>> = {}
  for (const level of CVSS_LEVELS) {
    const v = rec?.[key[level]]
    if (typeof v === 'number' && v > 0) out[level] = v
  }
  return out
}

const hasAny = (a: Partial<Record<CvssLevel, number>>) => CVSS_LEVELS.some((l) => a[l] != null)

/** Extrae las filas de reward (asset value → importes CVSS) del programa. */
export function rewardRows(program: Program): RewardRow[] {
  const rows: RewardRow[] = []
  for (const s of program.scopes) {
    const value = s.asset_value?.toUpperCase() ?? ''
    const grid = GRID_BY_VALUE[value]?.(program) ?? program.reward_grid_default
    const amounts = toAmounts(grid)
    if (hasAny(amounts) && !rows.some((r) => r.value === value)) {
      rows.push({ value, amounts })
    }
  }
  // Si ningún scope trajo grid con importes, probar el default por sí solo
  if (rows.length === 0) {
    const amounts = toAmounts(program.reward_grid_default)
    if (hasAny(amounts)) rows.push({ value: '', amounts })
  }
  return rows
}

/** Símbolo de moneda para el render (solo maneja EUR → €; resto pasa tal cual). */
export function currencySymbol(currency: string | null | undefined): string {
  const c = currency ?? 'EUR'
  return c === 'EUR' ? '€' : c
}
