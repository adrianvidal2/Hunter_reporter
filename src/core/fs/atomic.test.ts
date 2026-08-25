import { readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createFixture } from '../../test/fixtures/fixture'
import { writeAtomic } from './atomic'

// Mock parcial de node:fs: solo renameSync es espiable/fallible, el resto
// (incluido lo que usa el fixture) sigue siendo el real.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, renameSync: vi.fn(actual.renameSync) }
})

const noTmpLeft = (dir: string) =>
  readdirSync(dir).filter((f) => f.includes('.tmp')).length === 0

describe('writeAtomic', () => {
  it('escribe un fichero nuevo y también reemplaza uno existente, sin dejar .tmp', () => {
    const fx = createFixture()
    try {
      // Fichero nuevo (no existe): resolveSafeAllowMissing
      const target = writeAtomic('demo_project/reportes/informe-nuevo.md', '# Nuevo\n', {
        root: fx.root,
      })
      expect(readFileSync(target, 'utf8')).toBe('# Nuevo\n')
      expect(path.dirname(target)).toBe(path.resolve(fx.draftsDir))
      expect(noTmpLeft(fx.draftsDir)).toBe(true)

      // Sobre un fichero existente: el contenido se reemplaza entero
      writeAtomic('demo_project/reportes/borrador-sqli.md', 'reescrito', { root: fx.root })
      expect(readFileSync(fx.mdPlain, 'utf8')).toBe('reescrito')

      // Buffer binario y fichero vacío
      writeAtomic('demo_project/reportes/bin.md', Buffer.from([0x00, 0x01, 0xff]), { root: fx.root })
      expect(readFileSync(path.join(fx.draftsDir, 'bin.md'))).toEqual(Buffer.from([0x00, 0x01, 0xff]))
      writeAtomic('demo_project/reportes/vacio.md', '', { root: fx.root })
      expect(readFileSync(path.join(fx.draftsDir, 'vacio.md'), 'utf8')).toBe('')
      expect(noTmpLeft(fx.draftsDir)).toBe(true)
    } finally {
      fx.cleanup()
    }
  })

  it('con rename fallando, lanza y el original queda intacto, sin .tmp residual', () => {
    const fx = createFixture()
    try {
      writeFileSync(fx.mdPlain, 'contenido original valioso')
      vi.mocked(renameSync).mockImplementationOnce(() => {
        throw Object.assign(new Error('EIO simulado en rename'), { code: 'EIO' })
      })

      expect(() =>
        writeAtomic('demo_project/reportes/borrador-sqli.md', 'contenido nuevo', { root: fx.root }),
      ).toThrow(/EIO simulado/)

      // El original NO cambió
      expect(readFileSync(fx.mdPlain, 'utf8')).toBe('contenido original valioso')
      // Y no queda ningún .tmp en el directorio
      expect(noTmpLeft(fx.draftsDir)).toBe(true)
      // El rename se intentó de verdad (el .tmp llegó a crearse y borrarse)
      expect(renameSync).toHaveBeenCalled()
    } finally {
      fx.cleanup()
      // mockImplementationOnce se auto-restaura tras un uso: nada que deshacer
    }
  })

  it('rechaza con PathEscapeError una ruta que sale del root', () => {
    const fx = createFixture()
    try {
      expect(() => writeAtomic('../fuera.md', 'x', { root: fx.root })).toThrow(
        /fuera de REPORTS_ROOT/,
      )
      expect(noTmpLeft(fx.root)).toBe(true)
    } finally {
      fx.cleanup()
    }
  })
})
