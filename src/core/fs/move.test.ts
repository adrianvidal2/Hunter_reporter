import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFixture } from '../../test/fixtures/fixture'
import { PathEscapeError } from './paths'
import { ConflictError, moveFile } from './move'

describe('moveFile', () => {
  it('mueve un fichero a otro proyecto conservando el contenido', () => {
    const fx = createFixture({ extraProjects: ['banco_demo'] })
    try {
      mkdirSync(path.join(fx.root, 'banco_demo', 'reportes'), { recursive: true })

      const dst = moveFile(
        'demo_project/reportes/borrador-sqli.md',
        'banco_demo/reportes/borrador-sqli.md',
        { root: fx.root },
      )

      expect(readFileSync(dst, 'utf8')).toContain('SQLi')
      expect(existsSync(fx.mdPlain)).toBe(false) // ya no está en el origen
      expect(path.dirname(dst)).toBe(path.resolve(fx.root, 'banco_demo', 'reportes'))
    } finally {
      fx.cleanup()
    }
  })

  it('destino existente → ConflictError y nada cambia (tampoco sobre sí mismo)', () => {
    const fx = createFixture()
    try {
      writeFileSync(path.join(fx.draftsDir, 'copia.md'), 'contenido del destino original')

      expect(() =>
        moveFile('demo_project/reportes/borrador-sqli.md', 'demo_project/reportes/copia.md', {
          root: fx.root,
        }),
      ).toThrow(ConflictError)

      // El destino conserva su contenido y el origen sigue ahí
      expect(readFileSync(path.join(fx.draftsDir, 'copia.md'), 'utf8')).toBe(
        'contenido del destino original',
      )
      expect(existsSync(fx.mdPlain)).toBe(true)

      // Mover sobre sí mismo: también colisión
      expect(() =>
        moveFile('demo_project/reportes/borrador-sqli.md', 'demo_project/reportes/borrador-sqli.md', {
          root: fx.root,
        }),
      ).toThrow(ConflictError)
    } finally {
      fx.cleanup()
    }
  })

  it('src inexistente → error de fs; rutas que escapan → PathEscapeError', () => {
    const fx = createFixture()
    try {
      expect(() =>
        moveFile('demo_project/reportes/no-existe.md', 'demo_project/reportes/destino.md', {
          root: fx.root,
        }),
      ).toThrow(expect.objectContaining({ code: 'ENOENT' }))

      expect(() =>
        moveFile('../fuera.md', 'demo_project/reportes/destino.md', { root: fx.root }),
      ).toThrow(PathEscapeError)
      expect(() =>
        moveFile('demo_project/reportes/borrador-sqli.md', '../fuera.md', { root: fx.root }),
      ).toThrow(PathEscapeError)
      expect(existsSync(fx.mdPlain)).toBe(true)
    } finally {
      fx.cleanup()
    }
  })
})
