import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFixture } from '../../test/fixtures/fixture'
import { saveHistoryCopy } from './history'

describe('saveHistoryCopy', () => {
  it('archiva el contenido ACTUAL en .history/<relpath>/ antes de sobrescribir', () => {
    const fx = createFixture()
    try {
      const archived = saveHistoryCopy('demo_project/reportes/informe-idor.md', fx.root)

      expect(archived).toBeTruthy()
      expect(path.dirname(archived!)).toBe(
        path.resolve(fx.root, '.history/demo_project/reportes/informe-idor.md'),
      )
      // La copia conserva el contenido previo a la sobrescritura
      writeFileSync(fx.mdFrontMatter, 'contenido nuevo tras archivar')
      expect(readFileSync(archived!, 'utf8')).toContain('IDOR en /api/v1/users')
    } finally {
      fx.cleanup()
    }
  })

  it('fichero inexistente → null sin crear nada', () => {
    const fx = createFixture()
    try {
      expect(saveHistoryCopy('demo_project/reportes/no-hay.md', fx.root)).toBeNull()
      expect(existsSync(path.join(fx.root, '.history'))).toBe(false)
    } finally {
      fx.cleanup()
    }
  })

  it('máximo 20: 25 archivadas → quedan 20, las más recientes', () => {
    const fx = createFixture()
    try {
      for (let i = 1; i <= 25; i++) {
        writeFileSync(fx.mdPlain, `versión ${i}`)
        saveHistoryCopy('demo_project/reportes/borrador-sqli.md', fx.root)
      }

      const dir = path.join(fx.root, '.history/demo_project/reportes/borrador-sqli.md')
      const entries = readdirSync(dir).sort()
      expect(entries).toHaveLength(20)
      // La más reciente es la versión 25; la más vieja retenida, la 6
      expect(readFileSync(path.join(dir, entries.at(-1)!), 'utf8')).toBe('versión 25')
      expect(readFileSync(path.join(dir, entries[0]!), 'utf8')).toBe('versión 6')
    } finally {
      fx.cleanup()
    }
  })
})
