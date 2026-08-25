import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readProgramFile, readProjectProgram, projectProgramPath } from './program-file'

const dir = mkdtempSync(join(tmpdir(), 'ywh-program-file-'))
const fixture = join(dir, 'programa.json')

// Root de proyecto simulado: <root>/proyectoX/programa.json
const root = join(dir, 'root')
const projDir = join(root, 'proyectoX')
mkdirSync(projDir, { recursive: true })
const projFile = join(projDir, 'programa.json')

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

describe('readProjectProgram (por proyecto, programa.json)', () => {
  it('lee el programa.json del proyecto dado (ruta segura dentro del root)', () => {
    writeFileSync(projFile, JSON.stringify(minProgram({ slug: 'proyecto-x' })))
    const p = readProjectProgram('proyectoX', root)
    expect(p).not.toBeNull()
    expect(p!.slug).toBe('proyecto-x')
    expect(projectProgramPath('proyectoX', root)).toBe(projFile)
  })

  it('devuelve null si el proyecto no tiene programa.json (→ “Sin datos del programa”)', () => {
    expect(readProjectProgram('sin-programa', root)).toBeNull()
  })

  it('path traversal se rechaza: subir fuera del root lanza error de ruta', () => {
    expect(() => projectProgramPath('../fuera', root)).toThrow()
  })
})
