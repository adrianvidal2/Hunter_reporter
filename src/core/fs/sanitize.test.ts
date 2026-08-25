import { describe, expect, it } from 'vitest'
import { InvalidFilenameError, sanitizeFilename } from './sanitize'

describe('sanitizeFilename', () => {
  it('deja pasar un nombre normal sin cambios', () => {
    expect(sanitizeFilename('informe-xss.pdf')).toBe('informe-xss.pdf')
    expect(sanitizeFilename('borrador_sqli (2).md')).toBe('borrador_sqli (2).md')
  })

  it('elimina /, \\ y ..', () => {
    expect(sanitizeFilename('a/b/c.txt')).toBe('abc.txt')
    expect(sanitizeFilename('..\\..\\windows\\system32')).toBe('windowssystem32')
    expect(sanitizeFilename('../../etc/passwd')).toBe('etcpasswd')
    // Si tras limpiar no queda nada, error claro
    expect(() => sanitizeFilename('///..\\\\')).toThrow(InvalidFilenameError)
  })

  it('conserva emojis y normaliza a NFC', () => {
    const out = sanitizeFilename('informe 🐛 xss.pdf')
    expect(out).toBe('informe 🐛 xss.pdf')
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(200)
    // 'e' + acento combinante → 'é' compuesto (NFC)
    expect(sanitizeFilename('cafe\u0301.md')).toBe('café.md')
  })

  it('recorta a 200 bytes sin partir caracteres', () => {
    expect(Buffer.byteLength(sanitizeFilename('a'.repeat(300)))).toBe(200)
    const multibyte = sanitizeFilename('é'.repeat(150)) // 300 bytes en UTF-8
    expect(multibyte).toBe('é'.repeat(100)) // 200 bytes exactos
    expect(multibyte.includes('\uFFFD')).toBe(false) // sin caracteres rotos
  })
})
