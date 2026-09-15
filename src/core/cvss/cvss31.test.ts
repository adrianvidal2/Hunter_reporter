import { describe, expect, it } from 'vitest'
import {
  computeBaseScore,
  computeCvss31,
  type CvssSeverity,
  CvssError,
  fromVector,
  metricsToVector,
  parseCvss31Vector,
  roundup,
  severityFromScore,
  type CvssMetrics,
} from './cvss31'

/** Vectores de ejemplo PUBLICADOS (especificación FIRST / valores NVD habituales). */
const PUBLISHED: [string, number][] = [
  // Par S:U vs S:C de la especificación (8.2): el 1.08 y el cap
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', 9.8],
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H', 10.0],
  // UI Required (par típico de XSS/reflected)
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H', 8.8],
  // Confidencialidad alta sola
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N', 7.5],
  // Escalada local (privesc)
  ['CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H', 7.8],
  // Ejemplo Scope Changed con PR Low (fórmula 7.52/3.25^15 del impacto)
  ['CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:L/I:L/A:N', 6.4],
  // Valores bajos frecuentes en NVD
  ['CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N', 5.4],
  ['CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L', 4.3],
  ['CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:C/C:L/I:L/A:N', 4.7],
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N', 6.1],
]

const base: CvssMetrics = { AV: 'N', AC: 'L', PR: 'N', UI: 'N', S: 'U', C: 'H', I: 'H', A: 'H' }

describe('computeBaseScore: vectores publicados de la especificación', () => {
  it.each(PUBLISHED)('%s → %s', (vector, expected) => {
    expect(computeBaseScore(parseCvss31Vector(vector))).toBe(expected)
  })
})

describe('roundup (apéndice A: ceil a 1 decimal cuantizado, NO Math.round)', () => {
  it('absorbe el ruido IEEE de un valor exacto: 6.4 → 6.4, no 6.5', () => {
    expect(roundup(6.4)).toBe(6.4)
    expect(roundup(8.8)).toBe(8.8)
    expect(roundup(7.0)).toBe(7.0)
  })
  it('siempre alza: 9.760164… → 9.8 (el 9.8 real de la especificación)', () => {
    expect(roundup(9.7601639716666667)).toBe(9.8)
    expect(roundup(4.911999)).toBe(5.0)
  })
  it('cualquier resto por debajo de la décima sube a la siguiente', () => {
    expect(roundup(5.00001)).toBe(5.1)
    expect(roundup(5.09999)).toBe(5.1)
    expect(roundup(5.1)).toBe(5.1)
  })
  it('los múltiplos exactos de 0.1 se quedan igual', () => {
    expect(roundup(0)).toBe(0)
    expect(roundup(10)).toBe(10)
    expect(roundup(0.3)).toBe(0.3)
  })
  it('Math.round daría resultados distintos (regresión contra el error clásico)', () => {
    // 7.25 con Math.round a 1 decimal daría 7.3 si redondearas normal tras
    // el ceil… aquí el ceil a la ALZA desde 7.20001 da 7.3, y 7.2 se queda
    expect(roundup(7.20001)).toBe(7.3)
    expect(roundup(7.2)).toBe(7.2)
  })
})

describe('Scope Changed vs Unchanged: cambia la FÓRMULA (no solo un factor)', () => {
  it('el mismo resto de métricas con S:C cambia el score (1.08 y PR distinto)', () => {
    const su = computeBaseScore({ ...base, S: 'U' })
    const sc = computeBaseScore({ ...base, S: 'C' })
    expect(su).toBe(9.8)
    expect(sc).toBe(10.0)
  })
  it('el peso de PR depende del scope (L: 0.62 sin cambio, 0.68 con cambio)', () => {
    const m = { AV: 'N', AC: 'L', PR: 'L', UI: 'N', C: 'H', I: 'H', A: 'H' } as const
    const su = computeBaseScore({ ...m, S: 'U' })
    const sc = computeBaseScore({ ...m, S: 'C' })
    expect(su).toBe(8.8)
    expect(sc).toBe(9.9)
  })
  it('impacto <= 0 (todo N/N) → score 0 y severidad None', () => {
    const zero = { AV: 'N', AC: 'L', PR: 'N', UI: 'N', S: 'U', C: 'N', I: 'N', A: 'N' } as const
    expect(computeBaseScore(zero)).toBe(0)
    expect(severityFromScore(0)).toBe('None')
  })
})

describe('severityFromScore: cortes de la sección 5', () => {
  const cases: [number, CvssSeverity][] = [
    [0, 'None'],
    [0.1, 'Low'],
    [3.9, 'Low'],
    [4.0, 'Medium'],
    [6.9, 'Medium'],
    [7.0, 'High'],
    [8.9, 'High'],
    [9.0, 'Critical'],
    [10.0, 'Critical'],
  ]
  it.each(cases)('%s → %s', (score, sev) => {
    expect(severityFromScore(score)).toBe(sev)
  })
})

describe('parseCvss31Vector: errores', () => {
  it('prefijo incorrecto o ausente → reason=prefix', () => {
    expect(() => parseCvss31Vector('CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toThrow(
      expect.objectContaining({ reason: 'prefix' } as CvssError),
    )
    expect(() => parseCvss31Vector('AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toThrow(
      expect.objectContaining({ reason: 'prefix' } as CvssError),
    )
  })
  it('parte mal formada → reason=malformed', () => {
    expect(() => parseCvss31Vector('CVSS:3.1/AV:N/basura/PR:N/UI:N/S:U/C:H/I:H/A:H')).toThrow(
      expect.objectContaining({ reason: 'malformed' } as CvssError),
    )
    expect(() => parseCvss31Vector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/extra')).toThrow(
      expect.objectContaining({ reason: 'malformed' } as CvssError),
    )
  })
  it('métrica desconocida (p. ej. E: de Temporal) → reason=unknown', () => {
    expect(() => parseCvss31Vector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/E:F')).toThrow(
      expect.objectContaining({ reason: 'unknown' } as CvssError),
    )
  })
  it('valor fuera del enum → reason=invalid_value', () => {
    expect(() => parseCvss31Vector('CVSS:3.1/AV:X/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toThrow(
      expect.objectContaining({ reason: 'invalid_value' } as CvssError),
    )
    expect(() => parseCvss31Vector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:X/C:H/I:H/A:H')).toThrow(
      expect.objectContaining({ reason: 'invalid_value' } as CvssError),
    )
  })
  it('métrica duplicada → reason=duplicate', () => {
    expect(() => parseCvss31Vector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/AV:P')).toThrow(
      expect.objectContaining({ reason: 'duplicate' } as CvssError),
    )
  })
  it('vector incompleto → reason=incomplete y lista lo que falta', () => {
    try {
      parseCvss31Vector('CVSS:3.1/AV:N/AC:L/PR:N/C:H/I:H/A:H')
      expect.unreachable()
    } catch (err) {
      const e = err as CvssError
      expect(e.reason).toBe('incomplete')
      expect(e.message).toMatch(/UI, S/)
    }
  })
})

describe('round-trip: métricas → vector → métricas', () => {
  it.each(PUBLISHED)('%s', (vector) => {
    const metrics = parseCvss31Vector(vector)
    const back = parseCvss31Vector(metricsToVector(metrics))
    expect(back).toEqual(metrics)
  })
  it('computeCvss31 devuelve el trío completo y el vector canónico re-parsea', () => {
    const { score, severity, vector } = computeCvss31(base)
    expect(score).toBe(9.8)
    expect(severity).toBe('Critical')
    expect(vector).toBe('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')
    const again = fromVector(vector)
    expect(again.score).toBe(score)
    expect(again.metrics).toEqual(base)
  })
})
