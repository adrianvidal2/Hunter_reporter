/**
 * CVSS v3.1 Base Score — implementación de la especificación oficial de
 * FIRST (https://www.first.org/cvss/v3.1/specification-document).
 *
 * Solo Base Score: AV, AC, PR, UI, S, C, I, A. Sin Temporal ni Environmental.
 *
 * Funciones PURAS: métricas → { score, severity, vector } y la inversa
 * (vector → métricas, con validación estricta).
 *
 * Fórmulas de la especificación (sección 8.2) verificadas literalmente:
 * - ISS = 1 − (1−C)(1−I)(1−A)
 * - Impact S:U = 6.42 × ISS
 * - Impact S:C = 7.52 × (ISS − 0.029) − 3.25 × (ISS − 0.02)^15
 * - Exploitability = 8.22 × AV × AC × PR × UI   (PR depende del Scope)
 * - Score S:U = Roundup(min(Impact + Exploitability, 10))
 * - Score S:C = Roundup(min(1.08 × (Impact + Exploitability), 10))
 * - Roundup (apéndice A): redondeo al entero más cercano de ×100000 y
 *   ceil a la ALZA en la cuarta cifra decimal — NO Math.round/toFixed.
 */

export const CVSS_METRIC_KEYS = ['AV', 'AC', 'PR', 'UI', 'S', 'C', 'I', 'A'] as const

export type CvssMetricKey = (typeof CVSS_METRIC_KEYS)[number]

export type CvssMetrics = Record<CvssMetricKey, string>

export type CvssSeverity = 'None' | 'Low' | 'Medium' | 'High' | 'Critical'

/** Pesos oficiales (tabla 16 de la especificación). */
const WEIGHTS: Record<CvssMetricKey, Record<string, number>> = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  PR: { N: 0.85, L: 0.62, H: 0.27 }, // Scope Unchanged
  UI: { N: 0.85, R: 0.62 },
  S: { U: 0, C: 0 }, // solo bandera de scope
  C: { H: 0.56, L: 0.22, N: 0 },
  I: { H: 0.56, L: 0.22, N: 0 },
  A: { H: 0.56, L: 0.22, N: 0 },
}

/** PR con Scope Changed (tabla 16: "or 0.68 / 0.5 if Scope is Changed"). */
const PR_CHANGED: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 }

/**
 * Roundup del apéndice A de la especificación: al entero más cercano de
 * input×100000 y, si no cae en múltiplo exacto de 10^4, ceil a la ALZA en
 * la décima. El redondeo previo a nearest es lo que absorbe el ruido IEEE
 * (6.4×100000 = 640000.00000…05 → 6.4, no 6.5).
 */
export function roundup(input: number): number {
  const intInput = Math.round(input * 100000)
  if (intInput % 10000 === 0) {
    return intInput / 100000
  }
  return (Math.floor(intInput / 10000) + 1) / 10
}

/** Severidad cualitativa (sección 5 de la especificación). */
export function severityFromScore(score: number): CvssSeverity {
  if (score === 0) return 'None'
  if (score <= 3.9) return 'Low'
  if (score <= 6.9) return 'Medium'
  if (score <= 8.9) return 'High'
  return 'Critical'
}

/** Calcula el Base Score a partir de las métricas (todas las 8 requeridas). */
export function computeBaseScore(m: CvssMetrics): number {
  for (const key of CVSS_METRIC_KEYS) {
    const value = m[key]
    if (typeof value !== 'string' || !(value in WEIGHTS[key])) {
      throw new CvssError(`Métrica ${key} falta o tiene valor inválido: ${String(value)}`)
    }
  }

  const scopeChanged = m.S === 'C'
  const prWeight = scopeChanged ? PR_CHANGED[m.PR]! : WEIGHTS.PR[m.PR]!

  // ISS (Impact Sub-Score): 1 − (1−C)(1−I)(1−A)
  const iss = 1 - (1 - WEIGHTS.C[m.C]!) * (1 - WEIGHTS.I[m.I]!) * (1 - WEIGHTS.A[m.A]!)

  const impact = scopeChanged
    ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
    : 6.42 * iss
  const exploitability = 8.22 * WEIGHTS.AV[m.AV]! * WEIGHTS.AC[m.AC]! * prWeight * WEIGHTS.UI[m.UI]!

  if (impact <= 0) return 0

  const raw = scopeChanged
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10)
  return roundup(raw)
}

/** Vector canónico a partir de las métricas: `CVSS:3.1/AV:N/…/A:H`. */
export function metricsToVector(m: CvssMetrics): string {
  return ['CVSS:3.1', ...CVSS_METRIC_KEYS.map((k) => `${k}:${m[k]}`)].join('/')
}

/** Dado el conjunto de métricas: score + severidad + vector canónico. */
export function computeCvss31(m: CvssMetrics): { score: number; severity: CvssSeverity; vector: string } {
  const score = computeBaseScore(m)
  return { score, severity: severityFromScore(score), vector: metricsToVector(m) }
}

/** Error de parseo con motivo concreto (prefix/unknown/duplicate/incomplete/malformed/invalid_value). */
export class CvssError extends Error {
  constructor(
    message: string,
    public reason: 'malformed' | 'prefix' | 'unknown' | 'duplicate' | 'incomplete' | 'invalid_value' = 'malformed',
  ) {
    super(message)
    this.name = 'CvssError'
  }
}

const KEY_BY_NAME: Record<string, CvssMetricKey> = Object.fromEntries(
  CVSS_METRIC_KEYS.map((k) => [k, k]),
) as Record<string, CvssMetricKey>

/**
 * Parsea un vector string CVSS 3.1 y devuelve las métricas. Estricto:
 * - prefijo `CVSS:3.1` requerido
 * - cada parte debe ser `CLAVE:valor` con valor del enum oficial
 * - sin duplicados, sin métricas desconocidas, valores válidos
 * - las 8 métricas Base son requeridas (sin Temporal/Environmental)
 */
export function parseCvss31Vector(vector: string): CvssMetrics {
  if (typeof vector !== 'string') {
    throw new CvssError('El vector debe ser un string', 'malformed')
  }

  const parts = vector.split('/')
  const [prefix] = parts
  if (prefix !== 'CVSS:3.1') {
    throw new CvssError(`Prefijo inválido (se esperaba CVSS:3.1): ${JSON.stringify(prefix)}`, 'prefix')
  }

  const metrics: Partial<Record<CvssMetricKey, string>> = {}
  for (const part of parts.slice(1)) {
    if (!/^[A-Z]+:[A-Za-z0-9]+$/.test(part)) {
      throw new CvssError(`Parte mal formada: ${JSON.stringify(part)}`, 'malformed')
    }
    const colon = part.indexOf(':')
    const key = part.slice(0, colon)
    const value = part.slice(colon + 1)
    if (!(key in KEY_BY_NAME)) {
      throw new CvssError(`Métrica desconocida: ${key} (Base Score solo usa AV AC PR UI S C I A)`, 'unknown')
    }
    const k = KEY_BY_NAME[key]!
    if (metrics[k] !== undefined) {
      throw new CvssError(`Métrica duplicada: ${key}`, 'duplicate')
    }
    if (!(value in WEIGHTS[k])) {
      throw new CvssError(`Valor inválido para ${key}: ${value}`, 'invalid_value')
    }
    metrics[k] = value
  }

  const missing = CVSS_METRIC_KEYS.filter((k) => metrics[k] === undefined)
  if (missing.length > 0) {
    throw new CvssError(`Vector incompleto, faltan: ${missing.join(', ')}`, 'incomplete')
  }

  return metrics as CvssMetrics
}

/** Conveniencia: parsea y calcula en un paso. */
export function fromVector(vector: string): { score: number; severity: CvssSeverity; metrics: CvssMetrics } {
  const metrics = parseCvss31Vector(vector)
  const score = computeBaseScore(metrics)
  return { score, severity: severityFromScore(score), metrics }
}
