import { z } from 'zod'

/**
 * Tipos de la API Researcher de Intigriti (paso 2 del plan multiplataforma),
 * basados en el spec OpenAPI verificado (docs/intigriti-api.md +
 * docs/fixtures/intigriti/intigriti-swagger-v1.0.json).
 *
 * Misma política de tolerancia que core/ywh/types.ts ("campos desconocidos
 * no rompen"): strip de lo desconocido, `.catch(default)` en conocidos,
 * nullish explícito en los nullable reales del spec.
 *
 * Contratos clave (docs/intigriti-api.md):
 * - SIN endpoints públicos: sin token, /v1/programs es 401 (lo gestiona el
 *   cliente; aquí no hay degradación a "solo públicos" como en YWH).
 * - Los enum llegan como {id, value} (EnumerationViewModel).
 * - minBounty/maxBounty (MoneyViewModel) pueden faltar en VDP.
 * - rulesOfEngagement es nullable en el spec.
 * - NO hay submissions en esta API (definitivo, no reinvestigar).
 */

export const enumerationParser = z.object({
  id: z.number().catch(0),
  value: z.string().catch(''),
})

export const moneyParser = z
  .object({
    value: z.number().catch(0),
    currency: z.string().catch('EUR'),
  })
  .nullish()

/** Item de la lista (`GET /v1/programs?limit=&offset=`). */
export const programOverviewParser = z.object({
  id: z.string().catch(''),
  /** Slug de Intigriti (identifica el programa en las webLinks). */
  handle: z.string().catch(''),
  name: z.string().catch(''),
  following: z.boolean().catch(false),
  minBounty: moneyParser,
  maxBounty: moneyParser,
  confidentialityLevel: enumerationParser.nullish(),
  status: enumerationParser.nullish(),
  type: enumerationParser.nullish(),
  webLinks: z
    .object({ detail: z.string().catch('') })
    .nullish(),
  industry: z.string().nullish().catch(null),
})

/** Página de la lista: paginación por OFFSET (`{maxCount, records}`). */
export const programsPageParser = z.object({
  maxCount: z.number().catch(0),
  records: z.array(programOverviewParser),
})

export const skillParser = z.object({
  id: z.number().catch(0),
  name: z.string().catch(''),
})

/** Dominio del scope IN (DomainViewModel). */
export const domainParser = z.object({
  id: z.string().catch(''),
  type: enumerationParser.nullish(), // Wildcard / Url / …
  endpoint: z.string().catch(''),
  tier: enumerationParser.nullish(), // Critical / High / … / "No Bounty"
  description: z.string().catch(''),
  requiredSkills: z.array(skillParser).catch(() => []),
})

/** Versión incrustada de domains (`VersionViewModelOfListOfDomainViewModel`). */
export const domainVersionParser = z.object({
  id: z.string().catch(''),
  createdAt: z.number().nullish(),
  content: z.array(domainParser).catch(() => []),
})

export const testingRequirementsParser = z.object({
  intigritiMe: z.boolean().catch(false),
  automatedTooling: z.number().nullish(),
  /** Puede venir "" — el spec lo declara nullable. */
  userAgent: z.string().nullish().catch(null),
  /** Puede venir "" — header obligatorio alternativo al UA. */
  requestHeader: z.string().nullish().catch(null),
})

export const roeContentParser = z.object({
  description: z.string().catch(''),
  testingRequirements: testingRequirementsParser.catch(() => ({
    intigritiMe: false,
    automatedTooling: null,
    userAgent: null,
    requestHeader: null,
  })),
  safeHarbour: z.boolean().catch(false),
})

/** Reglas (`VersionWithAttachmentsViewModelOfRulesOfEngagementViewModel`), nullable en el spec. */
export const roeParser = z
  .object({
    id: z.string().catch(''),
    attachments: z.array(z.unknown()).catch(() => []),
    createdAt: z.number().nullish(),
    content: roeContentParser.catch(() => roeContentParser.parse({})),
  })
  .nullish()

/** Detalle (`GET /v1/programs/{programId}`) — supersetea el overview. */
export const programDetailParser = programOverviewParser.extend({
  domains: domainVersionParser.nullish(),
  rulesOfEngagement: roeParser,
})

export type Enumeration = z.infer<typeof enumerationParser>
export type Money = z.infer<typeof moneyParser>
export type ProgramOverview = z.infer<typeof programOverviewParser>
export type ProgramsPage = z.infer<typeof programsPageParser>
export type IntigritiDomain = z.infer<typeof domainParser>
export type DomainVersion = z.infer<typeof domainVersionParser>
export type TestingRequirements = z.infer<typeof testingRequirementsParser>
export type RulesOfEngagement = NonNullable<z.infer<typeof roeParser>>
export type ProgramDetail = z.infer<typeof programDetailParser>
