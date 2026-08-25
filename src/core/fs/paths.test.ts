import { realpathSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFixture } from '../../test/fixtures/fixture'
import { PathEscapeError, resolveSafe, resolveSafeAllowMissing } from './paths'

describe('resolveSafe', () => {
  it('una ruta válida devuelve la ruta real absoluta dentro del root', () => {
    const fx = createFixture()
    try {
      const resolved = resolveSafe('demo_project/reportes/informe-idor.md', fx.root)
      expect(resolved).toBe(realpathSync(fx.mdFrontMatter))
      expect(resolved.startsWith(realpathSync(fx.root) + path.sep)).toBe(true)
    } finally {
      fx.cleanup()
    }
  })

  it('un directorio válido también resuelve', () => {
    const fx = createFixture()
    try {
      const resolved = resolveSafe('demo_project/REPORTES_YWH', fx.root)
      expect(resolved).toBe(realpathSync(fx.deliveredDir))
    } finally {
      fx.cleanup()
    }
  })

  it("'../x' lanza PathEscapeError", () => {
    const fx = createFixture()
    try {
      expect(() => resolveSafe('../x', fx.root)).toThrow(PathEscapeError)
      expect(() => resolveSafe('demo_project/../../secret', fx.root)).toThrow(/fuera de REPORTS_ROOT/)
    } finally {
      fx.cleanup()
    }
  })

  it('una ruta inexistente dentro del root lanza error de fs (no PathEscapeError)', () => {
    const fx = createFixture()
    try {
      expect(() => resolveSafe('demo_project/reportes/no-existe.md', fx.root)).toThrow(
        expect.objectContaining({ code: 'ENOENT' }),
      )
    } finally {
      fx.cleanup()
    }
  })
})

describe('resolveSafeAllowMissing', () => {
  it('resuelve un fichero nuevo (o con directorios intermedios nuevos) dentro de un directorio válido', () => {
    const fx = createFixture()
    try {
      const drafts = realpathSync(fx.draftsDir)
      expect(resolveSafeAllowMissing('demo_project/reportes/nuevo-informe.md', fx.root)).toBe(
        path.join(drafts, 'nuevo-informe.md'),
      )
      // Directorio intermedio también inexistente: el ancestro existente más cercano es reportes/
      expect(resolveSafeAllowMissing('demo_project/reportes/sub/nuevo.md', fx.root)).toBe(
        path.join(drafts, 'sub', 'nuevo.md'),
      )
      // Para una ruta ya existente, coincide con resolveSafe
      expect(resolveSafeAllowMissing('demo_project/reportes/informe-idor.md', fx.root)).toBe(
        resolveSafe('demo_project/reportes/informe-idor.md', fx.root),
      )
    } finally {
      fx.cleanup()
    }
  })

  it('rechaza un fichero nuevo cuya ruta sale del root', () => {
    const fx = createFixture()
    try {
      expect(() => resolveSafeAllowMissing('../nuevo.md', fx.root)).toThrow(PathEscapeError)
      expect(() => resolveSafeAllowMissing('demo_project/../../nuevo.md', fx.root)).toThrow(
        PathEscapeError,
      )
    } finally {
      fx.cleanup()
    }
  })
})
