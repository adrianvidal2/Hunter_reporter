import { describe, expect, it } from 'vitest'
import { parseNucleiFindings } from './findings'

/** Línea JSONL de nuclei con los campos que emite con -json. */
function nucleiLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    'template-id': 'crlf-injection',
    host: 'https://api.ejemplo.com',
    'matched-at': 'https://api.ejemplo.com/search?q=x',
    info: { name: 'CRLF Injection', severity: 'medium', tags: ['crlf'] },
    type: 'http',
    ...overrides,
  })
}

describe('parseNucleiFindings (JSONL de nuclei → findings)', () => {
  it('varias líneas válidas → findings correctos, en orden', () => {
    const output = [nucleiLine(), nucleiLine({ 'template-id': 'xss', info: { name: 'XSS', severity: 'high' } }), nucleiLine()].join('\n')
    const findings = parseNucleiFindings(output)
    expect(findings).toHaveLength(2) // el tercero es dedup del primero
    expect(findings[0]).toEqual({
      templateId: 'crlf-injection',
      host: 'api.ejemplo.com',
      severity: 'medium',
      matchedAt: 'https://api.ejemplo.com/search?q=x',
      name: 'CRLF Injection',
    })
    expect(findings[1]).toEqual({
      templateId: 'xss',
      host: 'api.ejemplo.com',
      severity: 'high',
      matchedAt: 'https://api.ejemplo.com/search?q=x',
      name: 'XSS',
    })
  })

  it('línea malformada o vacía → se ignora sin romper', () => {
    const output = ['', '   ', '{no es json', '{"incompleto":', nucleiLine()].join('\n')
    expect(parseNucleiFindings(output)).toHaveLength(1)
  })

  it('dedup por template+host: dos hits iguales → 1 (aunque cambie matched-at)', () => {
    const output = [
      nucleiLine({ 'matched-at': 'https://api.ejemplo.com/a' }),
      nucleiLine({ 'matched-at': 'https://api.ejemplo.com/b' }),
    ].join('\n')
    const findings = parseNucleiFindings(output)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.matchedAt).toBe('https://api.ejemplo.com/a') // la primera aparición gana
  })

  it('mismo template en OTRO host → son dos findings', () => {
    const output = [nucleiLine(), nucleiLine({ host: 'https://app.ejemplo.com' })].join('\n')
    expect(parseNucleiFindings(output)).toHaveLength(2)
  })

  it('severidades mapeadas; lo desconocido → info', () => {
    const sev = (s: string) => parseNucleiFindings(nucleiLine({ info: { name: 'X', severity: s } }))[0]!.severity
    expect(sev('info')).toBe('info')
    expect(sev('low')).toBe('low')
    expect(sev('MEDIUM')).toBe('medium') // caja fuera
    expect(sev('high')).toBe('high')
    expect(sev('critical')).toBe('critical')
    expect(sev('unknown')).toBe('info')
    expect(sev('')).toBe('info')
  })

  it('campos ausentes o con tipos raros → defaults tolerantes, sin crash', () => {
    const findings = parseNucleiFindings(
      JSON.stringify({ 'template-id': 'tech-detect', host: 'api.ejemplo.com', info: null }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      templateId: 'tech-detect',
      host: 'api.ejemplo.com',
      severity: 'info',
      name: 'tech-detect', // sin nombre, el template-id hace de nombre
      matchedAt: '',
    })
  })

  it('host deducido de matched-at si host falta; sin host deducible → línea ignorada', () => {
    const fromMatched = parseNucleiFindings(
      JSON.stringify({ 'template-id': 'x', 'matched-at': 'https://otro.ejemplo.com/p', info: {} }),
    )
    expect(fromMatched[0]!.host).toBe('otro.ejemplo.com')
    expect(parseNucleiFindings(JSON.stringify({ 'template-id': 'x', info: {} }))).toEqual([])
  })

  it('entrada que NO es de nuclei (katana/gospider/texto) → []', () => {
    const katana = '{"timestamp":"...","method":"GET","url":"https://x.com/a"}\n'.concat(
      '{"method":"GET","url":"https://x.com/b"}',
    )
    expect(parseNucleiFindings(katana)).toEqual([])
    expect(parseNucleiFindings('[Get] [200] https://x.com/a')).toEqual([])
    expect(parseNucleiFindings('[crlf-injection] [http] [medium] https://x.com/a')).toEqual([])
    expect(parseNucleiFindings('')).toEqual([])
  })

  it('sin template-id no hay hallazgo identificable → ignorada', () => {
    expect(parseNucleiFindings(JSON.stringify({ host: 'api.ejemplo.com', info: { severity: 'high' } }))).toEqual([])
  })
})
