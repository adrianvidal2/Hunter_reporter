import { z } from 'zod'

/**
 * Tipos de la API de YesWeHack (paso 9.2), basados en la forma REAL
 * verificada (docs/ywh-api.md + fixtures anonimizados de 9.1).
 *
 * Tolerancia (criterio del plan: "campos desconocidos no rompen"):
 * - Campos desconocidos de la respuesta se IGNORAN (comportamiento por
 *   defecto de z.object: strip). La API real manda 35-74 campos; aquí solo
 *   tipamos lo que la app usa.
 * - Campos conocidos con `.catch(default)`: si un tipo cambia o llega null
 *   donde esperábamos valor, cae al default en vez de romper (mismo estilo
 *   que los parsers de yeswecaido, que sobreviven gracias a esto).
 * - Los nullable REALES observados (stats.max_reward, scopes completos…)
 *   se declaran nullish explícitos: no se falsean a 0.
 */

export const paginationParser = z.object({
  page: z.number(),
  nb_pages: z.number(),
  results_per_page: z.number(),
  nb_results: z.number(),
})

const assetParser = z.object({ url: z.string().nullish() }).nullish()

export const businessUnitParser = z
  .object({
    name: z.string().catch(''),
    slug: z.string().catch(''),
    description: z.string().catch(''),
    currency: z.string().catch('EUR'),
  })
  .nullish()

/** Item de la lista (`GET /programs?page=N`). */
export const shortProgramParser = z.object({
  /** DRIFT REAL (verificado en vivo 2026-08-21): la API manda pid como
   *  string (al menos a veces). Tolerante a string|number. */
  pid: z.union([z.string(), z.number()]).nullish().catch(undefined),
  title: z.string().catch(''),
  slug: z.string().catch(''),
  country: z.string().nullish().catch(null),
  type: z.string().catch('bug-bounty'), // observado: "bug-bounty" | "vdp-in-app"
  status: z.string().nullish().catch(null),
  public: z.boolean().catch(true),
  disabled: z.boolean().catch(false),
  archived: z.boolean().catch(false),
  bounty: z.boolean().catch(false),
  bounty_reward_min: z.number().catch(0),
  bounty_reward_max: z.number().catch(0),
  scopes_count: z.number().catch(0),
  reports_count: z.number().catch(0),
  business_unit: businessUnitParser,
  thumbnail: assetParser,
})

export function pageParser<T extends z.ZodTypeAny>(itemParser: T) {
  return z.object({
    items: z.array(itemParser),
    pagination: paginationParser,
  })
}

export const shortProgramPageParser = pageParser(shortProgramParser)

/** Scope de un programa (forma REAL: scope_type_name y report_count nullable). */
export const scopeParser = z.object({
  scope: z.string().catch(''),
  scope_type: z.string().catch(''),
  scope_type_name: z.string().nullish().catch(null),
  asset_value: z.string().catch('LOW'), // LOW..CRITICAL
  report_count: z.number().nullish(),
})

const rewardGridParser = z
  .object({
    bounty_low: z.number().catch(0),
    bounty_medium: z.number().catch(0),
    bounty_high: z.number().catch(0),
    bounty_critical: z.number().catch(0),
  })
  .nullish()

const statsParser = z
  .object({
    max_reward: z.number().nullish(),
    average_reward: z.number().nullish(),
    average_first_time_response: z.number().nullish(),
    total_reports: z.number().catch(0),
  })
  .nullish()

/** Detalle (`GET /programs/{slug}`) — supererset del short. */
export const programParser = shortProgramParser.extend({
  rules: z.string().catch(''),
  rules_html: z.string().catch(''),
  user_agent: z.string().catch(''),
  account_access: z.string().catch(''),
  account_access_html: z.string().catch(''),
  qualifying_vulnerability: z.array(z.string()).catch(() => []),
  non_qualifying_vulnerability: z.array(z.string()).catch(() => []),
  out_of_scope: z.array(z.string()).catch(() => []),
  scopes: z.array(scopeParser).catch(() => []), // null observado → []
  reward_grid_default: rewardGridParser,
  reward_grid_critical: rewardGridParser,
  reward_grid_high: rewardGridParser,
  reward_grid_medium: rewardGridParser,
  reward_grid_low: rewardGridParser,
  reward_grid_very_low: rewardGridParser,
  stats: statsParser,
})

export type Pagination = z.infer<typeof paginationParser>
export type ShortProgram = z.infer<typeof shortProgramParser>
export type ShortProgramPage = z.infer<typeof shortProgramPageParser>
export type Scope = z.infer<typeof scopeParser>
export type Program = z.infer<typeof programParser>
