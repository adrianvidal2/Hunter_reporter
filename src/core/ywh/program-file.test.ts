import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readProgramFile, readProjectProgram, projectProgramPath } from './program-file'

const dir = mkdtempSync(join(tmpdir(), 'ywh-program-file-'))
const fixture = join(dir, 'programa.json')

// Root de proyecto simulado: <root>/proyectoX/pentest/programa.json
const root = join(dir, 'root')
const projDir = join(root, 'proyectoX')
mkdirSync(projDir, { recursive: true })

afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** Programa mínimo que satisface programParser (campos requeridos). */
function minProgram(patch: Record<string, unknown> = {}) {
  const p = {
    pid: 'x',
    title: 'Test Program',
    slug: 'test-prog',
    user_agent: 'BugBounty-Test',
    rules: '# Ok',
    rules_html: '<h1>Ok</h1>',
    account_access: '',
    account_access_html: '',
    qualifying_vulnerability: ['XSS'],
    non_qualifying_vulnerability: ['Clickjacking'],
    out_of_scope: [],
    scopes: [{ scope: 'https://a.test', scope_type: 'web-application', asset_value: 'HIGH' }],
    ...patch,
  }
  return p
}

describe('readProgramFile (pestaña Programa, solo lectura local)', () => {
  it('parsea un programa válido y expone campos que renderiza la pestaña', () => {
    writeFileSync(fixture, JSON.stringify(minProgram()))
    const p = readProgramFile(fixture)
    expect(p).not.toBeNull()
    expect(p!.slug).toBe('test-prog')
    expect(p!.user_agent).toBe('BugBounty-Test')
    expect(p!.scopes).toHaveLength(1)
    expect(p!.scopes[0]!.scope).toBe('https://a.test')
    expect(p!.qualifying_vulnerability).toEqual(['XSS'])
  })

  it('devuelve null si el fichero no existe', () => {
    expect(readProgramFile(join(dir, 'no-existe.json'))).toBeNull()
  })

  it('devuelve null si el JSON es inválido o no es un objeto', () => {
    writeFileSync(fixture, 'no-es-json-valido{{')
    expect(readProgramFile(fixture)).toBeNull()
    writeFileSync(fixture, JSON.stringify([1, 2]))
    expect(readProgramFile(fixture)).toBeNull()
  })

  it('user_agent ausente → cadena vacía, no rompe', () => {
    writeFileSync(
      fixture,
      JSON.stringify(minProgram({ user_agent: undefined })),
    )
    const parsed = readProgramFile(fixture)
    expect(parsed?.user_agent).toBe('')
  })
})

describe('readProjectProgram (por proyecto, pentest/programa.json)', () => {
  it('lee el programa.json canónico de pentest/ (ruta segura dentro del root)', () => {
    const pentestDir = join(projDir, 'pentest')
    mkdirSync(pentestDir, { recursive: true })
    const pentestFile = join(pentestDir, 'programa.json')
    writeFileSync(pentestFile, JSON.stringify(minProgram({ slug: 'proyecto-x' })))
    const p = readProjectProgram('proyectoX', root)
    expect(p).not.toBeNull()
    expect(p!.slug).toBe('proyecto-x')
    expect(projectProgramPath('proyectoX', root)).toBe(pentestFile)
  })

  it('LECTURA RETROCOMPATIBLE: legacy en la raíz → se lee, se mueve a pentest/ y se borra el de la raíz', () => {
    const legacyDir = join(root, 'heredado')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'programa.json'), JSON.stringify(minProgram({ slug: 'heredado-1' })))

    const p = readProjectProgram('heredado', root)
    expect(p).not.toBeNull()
    expect(p!.slug).toBe('heredado-1')

    // migrado a pentest/ y el de la raíz YA NO ESTÁ
    expect(existsSync(join(legacyDir, 'pentest', 'programa.json'))).toBe(true)
    expect(existsSync(join(legacyDir, 'programa.json'))).toBe(false)
    // segunda lectura: estable (ya desde pentest/)
    expect(readProjectProgram('heredado', root)?.slug).toBe('heredado-1')
  })

  it('legacy CORRUPTO en la raíz: no se mueve ni se borra, devuelve null', () => {
    const legacyDir = join(root, 'roto')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'programa.json'), 'no-es-json{{')
    expect(readProjectProgram('roto', root)).toBeNull()
    expect(existsSync(join(legacyDir, 'programa.json'))).toBe(true)
    expect(existsSync(join(legacyDir, 'pentest'))).toBe(false)
  })

  it('devuelve null si el proyecto no tiene programa.json (→ “Sin datos del programa”)', () => {
    expect(readProjectProgram('sin-programa', root)).toBeNull()
  })

  it('path traversal se rechaza: subir fuera del root lanza error de ruta', () => {
    expect(() => projectProgramPath('../fuera', root)).toThrow()
  })
})
