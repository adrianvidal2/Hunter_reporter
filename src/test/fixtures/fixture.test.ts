import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFixture, PROJECT_NAME } from './fixture'

describe('createFixture', () => {
  it('crea el árbol esperado: proyecto con REPORTES_YWH (1 PDF) y reportes (2 .md)', () => {
    const fx = createFixture()
    try {
      expect(statSync(fx.project).isDirectory()).toBe(true)

      const delivered = readdirSync(fx.deliveredDir)
      expect(delivered).toEqual(['informe-xss-reflejado.pdf'])

      const drafts = readdirSync(fx.draftsDir).sort()
      expect(drafts).toEqual(['borrador-sqli.md', 'informe-idor.md'])

      // El PDF empieza con la cabecera y termina con EOF de verdad
      const pdf = readFileSync(fx.pdf)
      expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
      expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true)

      // Uno de los .md lleva front-matter y el otro no
      expect(readFileSync(fx.mdPlain, 'utf8').startsWith('---\n')).toBe(false)
      const fm = readFileSync(fx.mdFrontMatter, 'utf8')
      expect(fm.startsWith('---\n')).toBe(true)
      expect(fm).toContain('severity: critical')
    } finally {
      fx.cleanup()
    }
  })

  it('el árbol vive en tmpdir, fuera de la carpeta real de reportes', () => {
    const fx = createFixture()
    try {
      const reportsRoot = process.env.REPORTS_ROOT ?? ''
      expect(path.resolve(fx.root)).not.toBe(path.resolve(reportsRoot))
      expect(fx.root).toContain(path.join(path.sep, 'tmp'))
    } finally {
      fx.cleanup()
    }
  })

  it('cleanup() borra el árbol completo y es idempotente', () => {
    const fx = createFixture()
    expect(existsSync(fx.root)).toBe(true)
    fx.cleanup()
    expect(existsSync(fx.root)).toBe(false)
    expect(() => fx.cleanup()).not.toThrow()
  })

  it('dos fixtures simultáneos no pisan el mismo directorio', () => {
    const a = createFixture()
    const b = createFixture()
    try {
      expect(a.root).not.toBe(b.root)
      expect(existsSync(path.join(a.root, PROJECT_NAME))).toBe(true)
      expect(existsSync(path.join(b.root, PROJECT_NAME))).toBe(true)
    } finally {
      a.cleanup()
      b.cleanup()
    }
  })
})
