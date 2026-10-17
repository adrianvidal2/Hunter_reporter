import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FINDING_VIEW,
  FINDING_VIEW_STORAGE_KEY,
  normalizeViewMode,
  severityLabel,
  severityRank,
  severityStyle,
  sortBySeverity,
} from './finding-view'

describe('severityRank (critical=0 … info=4)', () => {
  it('orden de severidades del más grave al más leve', () => {
    expect(severityRank('critical')).toBe(0)
    expect(severityRank('high')).toBe(1)
    expect(severityRank('medium')).toBe(2)
    expect(severityRank('low')).toBe(3)
    expect(severityRank('info')).toBe(4)
  })

  it('desconocida, caja distinta o vacía → la más baja (4)', () => {
    expect(severityRank('desconocida')).toBe(4)
    expect(severityRank('HIGH')).toBe(1) // caja fuera
    expect(severityRank('')).toBe(4)
  })
})

describe('severityStyle (accesible claro/oscuro)', () => {
  it('cada severidad tiene su estilo; desconocida → neutro', () => {
    for (const sev of ['critical', 'high', 'medium', 'low', 'info']) {
      const style = severityStyle(sev)
      expect(style).toContain('dark:')
      expect(style).not.toBe(severityStyle('desconocida'))
    }
    expect(severityStyle('desconocida')).toMatch(/zinc/)
    expect(severityStyle('HIGH')).toBe(severityStyle('high'))
  })
})

describe('severityLabel', () => {
  it('normaliza y cae en info para vacío', () => {
    expect(severityLabel(' HIGH ')).toBe('high')
    expect(severityLabel('')).toBe('info')
    expect(severityLabel('critico')).toBe('critico') // no conocida: tal cual saneada
  })
})

describe('sortBySeverity (severidad + host + template; empates deterministas)', () => {
  const base = { name: 'x', matchedAt: '', toolId: 'nuclei', runDir: 'd', firstSeenAt: '', lastSeenAt: '' }

  it('critical primero; empate de severidad → host alfabético', () => {
    const sorted = sortBySeverity([
      { ...base, severity: 'low', host: 'b.com', templateId: 't1' },
      { ...base, severity: 'critical', host: 'z.com', templateId: 't2' },
      { ...base, severity: 'high', host: 'm.com', templateId: 't3' },
      { ...base, severity: 'critical', host: 'a.com', templateId: 't4' },
    ])
    expect(sorted.map((f) => `${f.severity}@${f.host}`)).toEqual([
      'critical@a.com',
      'critical@z.com',
      'high@m.com',
      'low@b.com',
    ])
  })

  it('mismo host y severidad → templateId como desempate final', () => {
    const sorted = sortBySeverity([
      { ...base, severity: 'medium', host: 'x.com', templateId: 'zzz' },
      { ...base, severity: 'medium', host: 'x.com', templateId: 'aaa' },
    ])
    expect(sorted.map((f) => f.templateId)).toEqual(['aaa', 'zzz'])
  })

  it('NO muta el array original (copia ordenada)', () => {
    const original = [
      { ...base, severity: 'info', host: 'b.com', templateId: 't1' },
      { ...base, severity: 'critical', host: 'a.com', templateId: 't2' },
    ]
    const snapshot = [...original]
    sortBySeverity(original)
    expect(original).toEqual(snapshot)
  })
})

describe('modo de vista (persistido en localStorage)', () => {
  it('default → tabla', () => {
    expect(DEFAULT_FINDING_VIEW).toBe('tabla')
    expect(normalizeViewMode(null)).toBe('tabla')
    expect(normalizeViewMode(undefined)).toBe('tabla')
  })

  it('modos válidos (caja fuera) pasan; inválidos → tabla', () => {
    expect(normalizeViewMode('tarjetas')).toBe('tarjetas')
    expect(normalizeViewMode('  TABLA ')).toBe('tabla')
    expect(normalizeViewMode('galería')).toBe('tabla')
    expect(normalizeViewMode('')).toBe('tabla')
  })

  it('clave de localStorage estable', () => {
    expect(FINDING_VIEW_STORAGE_KEY).toBe('reporter.findings.view')
  })
})
