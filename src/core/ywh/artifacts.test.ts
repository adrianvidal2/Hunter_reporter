import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createFixture } from '../../test/fixtures/fixture'
import { programParser, type Program } from './types'
import { renderProgramMarkdown } from './render'
import { writeProgramArtifacts } from './artifacts'

const here = path.dirname(fileURLToPath(import.meta.url))
const detail = JSON.parse(
  readFileSync(path.resolve(here, '../../../docs/fixtures/ywh/program-detail.json'), 'utf8'),
) as Record<string, unknown>
const program = programParser.parse(detail) as Program

describe('renderProgramMarkdown (9.6 ampliado)', () => {
  it('privado → banner de NDA; público → sin banner', () => {
    const privado = renderProgramMarkdown({ ...program, public: false })
    expect(privado).toMatch(/PROGRAMA PRIVADO — POSIBLE NDA/)
    expect(privado).toContain('No compartas este documento')

    const publico = renderProgramMarkdown({ ...program, public: true })
    expect(publico).not.toContain('NDA')
  })

  it('incluye los datos que usas: UA, scopes in/out, grids, stats y reglas', () => {
    const md = renderProgramMarkdown(program)
    expect(md).toContain(`# ${program.title}`)
    expect(md).toContain(program.user_agent!)
    for (const s of program.scopes) expect(md).toContain(s.scope)
    expect(md).toContain(`## Scope out (${program.out_of_scope.length})`)
    expect(md).toContain('## Reward grid')
    expect(md).toContain('## Reglas del programa')
    expect(md).toContain('programa.json')
  })
})

describe('writeProgramArtifacts (pentest/ con md + json)', () => {
  it('crea pentest/programa.md + programa.json y NO sobrescribe el md existente', () => {
    const fx = createFixture()
    try {
      const first = writeProgramArtifacts('anonymized-program-1', program, detail, fx.root)
      expect(first).toMatchObject({
        mdRelPath: 'anonymized-program-1/pentest/programa.md',
        jsonRelPath: 'anonymized-program-1/pentest/programa.json',
        preservedExisting: false,
      })
      const dir = path.join(fx.root, 'anonymized-program-1', 'pentest')
      expect(readFileSync(path.join(dir, 'programa.md'), 'utf8')).toContain(program.title)
      // json crudo: round-trip idéntico al input
      expect(JSON.parse(readFileSync(path.join(dir, 'programa.json'), 'utf8'))).toEqual(detail)
      // y la estructura del proyecto también existe
      expect(existsSync(path.join(fx.root, 'anonymized-program-1', 'REPORTES_YWH'))).toBe(true)
      expect(existsSync(path.join(fx.root, 'anonymized-program-1', 'reportes'))).toBe(true)

      // el usuario edita programa.md a mano…
      const editado = '# MI VERSIÓN EDITADA A MANO'
      writeFileSync(path.join(dir, 'programa.md'), editado)

      // segunda generación: respeta el editado y crea programa-<fecha>.md
      const second = writeProgramArtifacts('anonymized-program-1', program, detail, fx.root)
      expect(second.preservedExisting).toBe(true)
      expect(second.mdRelPath).toMatch(/pentest\/programa-\d{8}-\d{6}\.md$/)
      expect(readFileSync(path.join(dir, 'programa.md'), 'utf8')).toBe(editado) // intacto
      const mds = readdirSync(dir).filter((f) => f.endsWith('.md'))
      expect(mds).toHaveLength(2)
      // json actualizado (siempre fresco)
      expect(JSON.parse(readFileSync(path.join(dir, 'programa.json'), 'utf8'))).toEqual(detail)
    } finally {
      fx.cleanup()
    }
  })
})
