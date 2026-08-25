import { describe, expect, it } from 'vitest'
import { renderTemplate, templatePlaceholders } from './placeholders'

const TPL = [
  '# {{titulo}}',
  '',
  '## Pasos',
  '{{pasos}}',
  '',
  '> nota: {{ titulo }} (repetido: {{titulo}})',
  '',
  'literal escapado: \\{{impacto}}',
].join('\n')

describe('renderTemplate (7.2)', () => {
  it('placeholder ausente queda literal y visible', () => {
    const out = renderTemplate(TPL, { titulo: 'XSS', pasos: '1. abrir\n2. ver' })
    expect(out).toContain('> nota: XSS (repetido: XSS)')
    expect(out).toContain('## Pasos\n1. abrir\n2. ver')
    expect(out).toContain('{{impacto}}') // sin valor → literal
  })

  it('placeholder repetido: TODAS las ocurrencias se sustituyen', () => {
    const out = renderTemplate(TPL, { titulo: 'IDOR', pasos: 'p', impacto: 'alto' })
    expect(out.match(/IDOR/g)).toHaveLength(3) // h1, nota y repetido
    expect(out).not.toContain('{{titulo}}')
    expect(out).not.toContain('{{ titulo }}')
  })

  it('escapado: \\{{clave}} se emite literal SIN sustituir (aunque haya valor)', () => {
    const out = renderTemplate(TPL, { titulo: 't', pasos: 'p', impacto: 'alto' })
    expect(out).toContain('literal escapado: {{impacto}}')
    expect(out).not.toContain('\\{{')
    // y no es "alto": el escape impide la sustitución
    expect(out).not.toContain('literal escapado: alto')
  })

  it('sin placeholders ni valores → cadena idéntica', () => {
    const plain = '# Informe\n\nTexto normal sin placeholders.'
    expect(renderTemplate(plain, {})).toBe(plain)
  })
})

describe('templatePlaceholders', () => {
  it('lista claves útiles, ignora escapadas, tolera espacios', () => {
    expect(templatePlaceholders(TPL)).toEqual(['titulo', 'pasos', 'titulo', 'titulo'])
  })
})
