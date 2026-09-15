import type {
  NeutralBusinessUnit,
  NeutralProgramDetail,
  NeutralProgramStats,
  NeutralProgramSummary,
  NeutralRewardGrid,
  NeutralScope,
  PlatformId,
} from '../programs/types'
import type { Program, Scope, ShortProgram } from './types'

/**
 * Adaptador YWH → modelo neutro (paso 1 del plan multiplataforma).
 * REFACTOR PURO: mapea campo a campo lo que la UI ya consumía, sin añadir
 * ni cambiar comportamiento. El `raw` viaja siempre (condición 2, no lossy).
 */

const PLATFORM: PlatformId = 'yeswehack'

const REWARD_GRID_ORDER: [keyof Pick<Program, 'reward_grid_critical' | 'reward_grid_high' | 'reward_grid_medium' | 'reward_grid_low' | 'reward_grid_very_low'>, string][] = [
  ['reward_grid_critical', 'Critical'],
  ['reward_grid_high', 'High'],
  ['reward_grid_medium', 'Medium'],
  ['reward_grid_low', 'Low'],
  ['reward_grid_very_low', 'Very low'],
]

function toBusinessUnit(bu: ShortProgram['business_unit']): NeutralBusinessUnit | null {
  return bu ? { name: bu.name, currency: bu.currency } : null
}

function toScope(s: Scope): NeutralScope {
  return {
    target: s.scope,
    type: s.scope_type,
    typeLabel: s.scope_type_name ?? null,
    assetValue: s.asset_value,
    reportCount: s.report_count ?? null,
  }
}

/** Item de lista (`GET /programs?page=N`) → resumen neutro. */
export function shortProgramToNeutral(p: ShortProgram): NeutralProgramSummary {
  return {
    platform: PLATFORM,
    id: p.pid != null ? String(p.pid) : p.slug,
    slug: p.slug,
    title: p.title,
    type: p.type,
    status: p.status ?? null,
    isPublic: p.public,
    disabled: p.disabled,
    archived: p.archived,
    hasBounty: p.bounty,
    bountyMin: p.bounty_reward_min,
    bountyMax: p.bounty_reward_max,
    scopesCount: p.scopes_count,
    businessUnit: toBusinessUnit(p.business_unit),
    raw: p,
  }
}

/** Detalle (`GET /programs/{slug}`) → detalle neutro. */
export function programToNeutral(p: Program): NeutralProgramDetail {
  const rewardGrids: NeutralRewardGrid[] = []
  for (const [key, label] of REWARD_GRID_ORDER) {
    const g = p[key]
    if (g) {
      rewardGrids.push({
        label,
        amounts: {
          low: g.bounty_low,
          medium: g.bounty_medium,
          high: g.bounty_high,
          critical: g.bounty_critical,
        },
      })
    }
  }

  let stats: NeutralProgramStats | null = null
  if (p.stats) {
    stats = {
      totalReports: p.stats.total_reports,
      maxReward: p.stats.max_reward ?? null,
      averageReward: p.stats.average_reward ?? null,
      averageFirstResponseDays: p.stats.average_first_time_response ?? null,
    }
  }

  return {
    ...shortProgramToNeutral(p),
    userAgent: p.user_agent,
    rules: p.rules,
    inScope: p.scopes.map(toScope),
    outOfScope: p.out_of_scope,
    qualifying: p.qualifying_vulnerability,
    nonQualifying: p.non_qualifying_vulnerability,
    rewardGrids,
    stats,
  }
}
