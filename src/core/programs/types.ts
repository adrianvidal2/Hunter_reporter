/**
 * Modelo neutro de programas (paso 1 del plan multiplataforma, condiciones
 * en docs/intigriti-api.md): describe lo que la UI de Programas necesita
 * sin vocabulario de ninguna plataforma. El adaptador de cada plataforma
 * (core/ywh/adapter.ts hoy, Intigriti después) rellena estos tipos.
 *
 * CONDICIÓN 2 (no lossy): el modelo lleva SIEMPRE `raw`, la respuesta CRUD
 * de la plataforma tal cual, para que la pestaña específica de cada una
 * pueda mostrar campos que el neutro no modela. Prohibido perder campos.
 */

export type PlatformId = 'yeswehack' | 'intigriti'

/** Entrada del scope IN, común a plataformas. */
export interface NeutralScope {
  /** Dominio/URL/endpoint tal cual (lo que se copia a Burp). */
  target: string
  /** Tipo en vocabulario de la plataforma (wildcard, url…). */
  type: string
  /** Etiqueta legible del tipo, si la plataforma la da. */
  typeLabel: string | null
  /** Severidad del asset en texto de la plataforma (LOW..CRITICAL…). */
  assetValue: string
  reportCount: number | null
}

/** Fila de reward grid: importes por severidad. Intigriti no tiene grid → []. */
export interface NeutralRewardGrid {
  /** Etiqueta tal y como la pinta la UI (Critical, High…). */
  label: string
  amounts: {
    low: number
    medium: number
    high: number
    critical: number
  }
}

export interface NeutralProgramStats {
  totalReports: number
  maxReward: number | null
  averageReward: number | null
  averageFirstResponseDays: number | null
}

export interface NeutralBusinessUnit {
  name: string
  currency: string
}

/** Item de lista: lo que el maestro de Programas filtra y pinta. */
export interface NeutralProgramSummary {
  platform: PlatformId
  /** Identificador de plataforma (pid de YWH, uuid de Intigriti). */
  id: string
  /** Clave estable para selección/detalle (slug en YWH). */
  slug: string
  title: string
  /** Tipo en vocabulario de la plataforma ('bug-bounty', 'vdp-in-app'…). */
  type: string
  status: string | null
  isPublic: boolean
  disabled: boolean
  archived: boolean
  hasBounty: boolean
  bountyMin: number
  bountyMax: number
  scopesCount: number
  businessUnit: NeutralBusinessUnit | null
  /** Respuesta CRUD de la plataforma, sin tocar (condición 2). */
  raw: unknown
}

/** Detalle bajo demanda: supersetea el resumen. */
export interface NeutralProgramDetail extends NeutralProgramSummary {
  userAgent: string
  rules: string
  inScope: NeutralScope[]
  outOfScope: string[]
  qualifying: string[]
  nonQualifying: string[]
  /** Solo filas presentes (null en la plataforma → no entra). */
  rewardGrids: NeutralRewardGrid[]
  stats: NeutralProgramStats | null
}
