import { realpathSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFixture, type Fixture } from '../../test/fixtures/fixture'
import { PathEscapeError, resolveSafe, resolveSafeAllowMissing } from './paths'

/**
 * Batería de path traversal (paso 1.3 ⚠️).
 *
 * Cada vector se prueba contra resolveSafe Y resolveSafeAllowMissing.
 * Los tests están escritos mirando el vector de ataque, no la implementación:
 * "rechazado" significa lanzar PathEscapeError, y el caso positivo (symlink
 * interno) significa resolver exactamente al realpath del destino.
 */

const ATTACKS: ReadonlyArray<readonly [vector: string, label: string]> = [
  ['../../etc/passwd', 'traversal clásico'],
  ['..%2f..%2f', 'separador codificado como %2f'],
  ['....//', 'bypass de filtro que borra una pasada de ../'],
  ['%2e%2e%2f', 'punto-barra completamente codificado'],
  ['/etc/passwd', 'ruta absoluta POSIX'],
  ['C:\\Windows\\system32\\config\\sam', 'ruta absoluta Windows'],
  ['a\0b', 'byte nulo'],
  ['../'.repeat(300) + 'etc/passwd', '300 niveles de ../'],
  ['x'.repeat(5000), 'nombre de 5000 caracteres'],
]

let fx: Fixture

beforeEach(() => {
  fx = createFixture()
})

afterEach(() => {
  fx.cleanup()
})

describe.each(
  [
    ['resolveSafe', resolveSafe],
    ['resolveSafeAllowMissing', resolveSafeAllowMissing],
  ] as const,
)('%s · batería de traversal', (_name, fn) => {
  it.each(ATTACKS)('rechaza: %s (%s)', (vector, label) => {
    expect(() => fn(vector, fx.root), label).toThrow(PathEscapeError)
  })
})

describe('symlinks', () => {
  it('resolveSafe rechaza un symlink que apunta fuera del root', () => {
    symlinkSync('/etc', path.join(fx.root, 'puerta'))
    expect(() => resolveSafe('puerta/passwd', fx.root)).toThrow(PathEscapeError)
  })

  it('resolveSafeAllowMissing rechaza un symlink que apunta fuera del root', () => {
    symlinkSync('/etc', path.join(fx.root, 'puerta'))
    expect(() => resolveSafeAllowMissing('puerta/passwd', fx.root)).toThrow(PathEscapeError)
  })

  it('ACEPTA un symlink interno válido: resuelve al destino real dentro del root', () => {
    symlinkSync(fx.draftsDir, path.join(fx.root, 'atajo'))
    expect(resolveSafe('atajo/informe-idor.md', fx.root)).toBe(realpathSync(fx.mdFrontMatter))
    expect(resolveSafeAllowMissing('atajo/nuevo.md', fx.root)).toBe(
      path.join(realpathSync(fx.draftsDir), 'nuevo.md'),
    )
  })
})
