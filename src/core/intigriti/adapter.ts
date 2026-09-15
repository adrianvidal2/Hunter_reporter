import type {
  NeutralProgramDetail,
  NeutralProgramSummary,
  PlatformId,
} from '../programs/types'
import type { ProgramDetail, ProgramOverview } from './types'

/**
 * Adaptador Intigriti → modelo neutro (paso 4). Mismo contrato que el
 * adaptador YWH: mapea campo a campo lo que la UI consume y conserva el
 * `raw` íntegro (condición no-lossy).
 *
 * Notas de mapeo (docs/intigriti-api.md):
 * - isPublic se deduce de confidentialityLevel === "Public" (no hay flag
 *   `public` como en YWH).
 * - scopesCount: la LISTA no trae domains (solo el detalle) → 0; el
 *   detalle sí lo rellena.
 * - assetValue = tier del dominio en MAYÚSCULAS (Critical → CRITICAL),
 *   que es lo que la paleta de la UI espera; el valor original queda en raw.
 * - rewardGrids/stats/outOfScope estructurado: no existen → [] / null.
 */

const PLATFORM: PlatformId = 'intigriti'

function isPublic(p: ProgramOverview): boolean {
  return (p.confidentialityLevel?.value ?? '').toLowerCase() === 'public'
}

function hasBounty(p: ProgramOverview): boolean {
  return p.minBounty != null || p.maxBounty != null
}

/** Item de lista (`GET /v1/programs`) → resumen neutro. */
export function overviewToNeutral(p: ProgramOverview): NeutralProgramSummary {
  return {
    platform: PLATFORM,
    id: p.id || p.handle,
    slug: p.handle,
    title: p.name,
    type: p.type?.value ?? '',
    status: p.status?.value ?? null,
    isPublic: isPublic(p),
    disabled: false, // no existe el concepto en la API researcher
    archived: false,
    hasBounty: hasBounty(p),
    bountyMin: p.minBounty?.value ?? 0,
    bountyMax: p.maxBounty?.value ?? 0,
    scopesCount: 0,
    businessUnit: null, // no hay business unit en Intigriti
    raw: p,
  }
}

/** Detalle (`GET /v1/programs/{id}`) → detalle neutro. */
export function detailToNeutral(p: ProgramDetail): NeutralProgramDetail {
  const roe = p.rulesOfEngagement?.content ?? null
  const domains = p.domains?.content ?? []
  return {
    ...overviewToNeutral(p),
    scopesCount: domains.length,
    userAgent: roe?.testingRequirements.userAgent || '',
    rules: roe?.description ?? '',
    inScope: domains.map((d) => ({
      target: d.endpoint,
      type: d.type?.value ?? '',
      typeLabel: d.type?.value ?? null,
      assetValue: (d.tier?.value ?? '').toUpperCase(),
      reportCount: null,
    })),
    // El out-of-scope de Intigriti vive en el texto de las reglas, no hay
    // lista estructurada (queda accesible vía `rules` y `raw`).
    outOfScope: [],
    qualifying: [],
    nonQualifying: [],
    rewardGrids: [],
    stats: null,
  }
}
