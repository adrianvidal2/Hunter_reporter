import { describe, expect, it } from 'vitest'
import {
  analyzeRewrite,
  extractCodeBlocks,
  extractLiterals,
  extractUrls,
} from './review'

const ORIGINAL = [
  '# IDOR en /api/v1/users',
  '',
  '## Impacto',
  '',
  'CVSS: 8.6 y también CVSS 9.1 en la variante.',
  'El endpoint devuelve HTTP 200 y a veces HTTP 403.',
  'Escucha en port 8443.',
  'Reporte relacionado: #YWH-PGM40972-5 (CWE-639).',
  '',
  '```http',
  'GET /api/v1/users/123 HTTP/1.1',
  'Host: www.example-target.com',
  '```',
  '',
  '```json',
  '{"id": 123, "email": "user@example.com"}',
  '```',
  '',
  'Referencia: https://example.com/docs y https://blog.example.com/xss',
].join('\n')

describe('extractCodeBlocks (normalización SOLO bordes, matiz 1)', () => {
  it('hash igual pese a espacios finales y líneas vacías de borde; distinto con cambio interior', () => {
    const a = extractCodeBlocks('```\n\npayload con indentación\ny espacios   interiores\n\n```')
    const b = extractCodeBlocks('```\npayload con indentación  \ny espacios   interiors  \n```'.replace('interiors', 'interiores'))
    expect(a[0]!.hash).toBe(b[0]!.hash) // bordes recortados (finales y vacías)

    const c = extractCodeBlocks('```\npayload con indentación\ny espacios  interiores\n```')
    expect(a[0]!.hash).not.toBe(c[0]!.hash) // un espacio interior menos = MODIFICADO
  })

  it('indentación significativa (matiz 1): leading spaces NO se normalizan', () => {
    const plain = extractCodeBlocks('```\ncode\n```')[0]!
    const indented = extractCodeBlocks('```\n    code\n```')[0]!
    expect(plain.hash).not.toBe(indented.hash) // 4 espacios internos = distinto

    const dos = extractCodeBlocks('```\n  payload\n  segunda\n```')[0]!
    const cero = extractCodeBlocks('```\npayload\nsegunda\n```')[0]!
    expect(dos.hash).not.toBe(cero.hash) // bloque indentado vs no = MODIFICADO (falso positivo tolerado)
  })

  it('lang del fence se captura; bloques ~~~ también', () => {
    const blocks = extractCodeBlocks('```http\nGET /\n```\n\n~~~json\n{}\n~~~')
    expect(blocks.map((b) => b.lang)).toEqual(['http', 'json'])
  })
})

describe('extractUrls / extractLiterals', () => {
  it('URLs únicas sin puntuación final', () => {
    expect(extractUrls('ve https://a.com/x. y https://a.com/x')).toEqual(['https://a.com/x'])
  })

  it('CVSS, estados HTTP, puertos e identificadores', () => {
    const lit = extractLiterals(ORIGINAL)
    expect(lit.cvss).toEqual(['8.6', '9.1'])
    expect(lit.httpStatus).toEqual(['200', '403'])
    expect(lit.ports).toEqual(['8443'])
    expect(lit.identifiers).toEqual(['CWE-639', 'YWH-PGM40972-5'])
  })
})

describe('analyzeRewrite', () => {
  const TEMPLATE = [
    '# {{titulo}}',
    '',
    '## Executive Summary',
    '',
    '{{resumen}}',
    '',
    '## Impact',
    '',
    '{{impacto}}',
    '',
    '## Remediation',
    '',
    '{{remediacion}}',
  ].join('\n')

  const GOOD_PROPOSAL = [
    '# IDOR in /api/v1/users',
    '',
    '**Severity:** high (CVSS 8.6)',
    '',
    '## Executive Summary',
    '',
    'The endpoint returns HTTP 200 and sometimes HTTP 403.',
    'CVSS: 8.6 and CVSS 9.1 in the variant. Listens on port 8443.',
    'Related: #YWH-PGM40972-5 (CWE-639).',
    '',
    '```http',
    'GET /api/v1/users/123 HTTP/1.1',
    'Host: www.example-target.com',
    '```',
    '',
    '```json',
    '{"id": 123, "email": "user@example.com"}',
    '```',
    '',
    '## Impact',
    '',
    'See https://example.com/docs and https://blog.example.com/xss.',
    '',
    '## Remediation',
    '',
    'Add authorization checks.',
  ].join('\n')

  it('propuesta buena: bloques idénticos, URLs y literales completos, sin pérdidas', () => {
    const a = analyzeRewrite(ORIGINAL, GOOD_PROPOSAL, TEMPLATE)
    expect(a.blocks.filter((b) => b.status === 'identical')).toHaveLength(2)
    expect(a.urls.missing).toEqual([])
    expect(a.urls.added).toEqual([])
    expect(a.literals.every((l) => l.missing.length === 0 && l.added.length === 0)).toBe(true)
    expect(a.hasLoss).toBe(false)
    expect(a.missingTemplateSections).toEqual([])
  })

  it('bloque perdido y URL perdida → hasLoss true y señalización', () => {
    const bad = GOOD_PROPOSAL
      .replace('```json\n{"id": 123, "email": "user@example.com"}\n```', '')
      .replace('https://blog.example.com/xss', '')
    const a = analyzeRewrite(ORIGINAL, bad, TEMPLATE)
    expect(a.blocks.some((b) => b.status === 'lost')).toBe(true)
    expect(a.urls.missing).toContain('https://blog.example.com/xss')
    expect(a.hasLoss).toBe(true)
  })

  it('bloque modificado (interior cambiado) → modified, NO identical (falso positivo tolerado)', () => {
    const mod = GOOD_PROPOSAL.replace('"email": "user@example.com"', '"email": "otro@example.com"')
    const a = analyzeRewrite(ORIGINAL, mod, TEMPLATE)
    expect(a.blocks.some((b) => b.status === 'modified')).toBe(true)
    expect(a.blocks.filter((b) => b.status === 'identical')).toHaveLength(1)
  })

  it('matiz 2: categoría sin extracciones → "sin datos" en coberturas, no 0/0', () => {
    // sección SIN urls ni bloques internos: cobertura "sin datos" (no 0/0 en verde)
    const orig = '# T\n\n## A\n\nsolo texto sin evidencia\n\n## B\n\nve https://x.com/a\n'
    const prop = '# T\n\n## A\n\nplain text\n\n## B\n\nsee https://x.com/a\n'
    const a = analyzeRewrite(orig, prop, TEMPLATE)
    const secA = a.sections.find((s) => s.original === 'A')!
    expect(secA.urlCoverage).toBe('sin datos')
    expect(secA.blockCoverage).toBe('sin datos')

    // y una categoría de literales sin datos no señala pérdidas
    const ports = a.literals.find((l) => l.key === 'ports')!
    expect(ports.missing).toEqual([])
    expect(ports.added).toEqual([])
  })

  it('secciones de plantilla ausentes se listan; hallazgos numerados se ignoran', () => {
    const sinRemed = GOOD_PROPOSAL.replace('## Remediation\n\nAdd authorization checks.', '')
    const a = analyzeRewrite(ORIGINAL, sinRemed, TEMPLATE)
    expect(a.missingTemplateSections).toContain('Remediation')

    const tplConFinding = TEMPLATE.replace('{{impacto}}', '## Finding 1 — {{hallazgo}}')
    const a2 = analyzeRewrite(ORIGINAL, GOOD_PROPOSAL, tplConFinding)
    expect(a2.missingTemplateSections).not.toContain('Finding 1 — {{hallazgo}}')
  })

  it('sección del original sin cobertura en la propuesta (bloques internos perdidos)', () => {
    const bad = GOOD_PROPOSAL.replace(
      '```http\nGET /api/v1/users/123 HTTP/1.1\nHost: www.example-target.com\n```',
      '(código omitido)',
    )
    const a = analyzeRewrite(ORIGINAL, bad, TEMPLATE)
    // el título 'Impacto' del original concentra la evidencia: sus bloques no llegaron
    const impacto = a.sections.find((s) => s.original === 'Impacto')
    expect(impacto).toBeTruthy()
  })
})
