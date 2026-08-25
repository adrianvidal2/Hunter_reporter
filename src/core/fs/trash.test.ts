import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFixture } from '../../test/fixtures/fixture'
import { PathEscapeError } from './paths'
import { trashFile } from './trash'
import { listProjects } from './tree'

describe('trashFile', () => {
  it('elimina → aparece en .trash/ con su contenido y desaparece del origen', () => {
    const fx = createFixture()
    try {
      const original = readFileSync(fx.mdFrontMatter, 'utf8')
      const trashed = trashFile('demo_project/reportes/informe-idor.md', fx.root)

      expect(existsSync(fx.mdFrontMatter)).toBe(false) // ya no está en el proyecto
      expect(path.dirname(trashed)).toBe(path.resolve(fx.root, '.trash'))
      expect(readFileSync(trashed, 'utf8')).toBe(original) // contenido intacto
    } finally {
      fx.cleanup()
    }
  })

  it('borrados repetidos del mismo nombre no se pisan: quedan dos entradas', () => {
    const fx = createFixture()
    try {
      const name = 'repetido.md'

      writeFileSync(path.join(fx.draftsDir, name), 'primera versión')
      const first = trashFile(`demo_project/reportes/${name}`, fx.root)
      writeFileSync(path.join(fx.draftsDir, name), 'segunda versión')
      const second = trashFile(`demo_project/reportes/${name}`, fx.root)

      expect(first).not.toBe(second)
      const entries = readdirSync(path.join(fx.root, '.trash'))
      expect(entries).toHaveLength(2)
      expect(readFileSync(first, 'utf8')).toBe('primera versión')
      expect(readFileSync(second, 'utf8')).toBe('segunda versión')
    } finally {
      fx.cleanup()
    }
  })

  it('.trash sigue oculto para listProjects y los escapes se rechazan', () => {
    const fx = createFixture()
    try {
      trashFile('demo_project/reportes/borrador-sqli.md', fx.root)
      expect(listProjects(fx.root)).toEqual(['demo_project']) // .trash invisible

      expect(() => trashFile('../fuera.md', fx.root)).toThrow(PathEscapeError)
      expect(() => trashFile('demo_project/reportes/no-existe.md', fx.root)).toThrow(
        expect.objectContaining({ code: 'ENOENT' }),
      )
    } finally {
      fx.cleanup()
    }
  })
})
