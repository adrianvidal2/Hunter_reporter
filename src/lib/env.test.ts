import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EnvError, parseEnv } from './env'

// Regla del plan: los tests usan directorios temporales, jamás la carpeta real.
let root: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'reporter-env-'))
})

afterEach(() => {
  // Restaurar permisos por si un test los dejó restringidos, y limpiar.
  try {
    chmodSync(root, 0o700)
  } catch {
    // puede no existir ya
  }
  rmSync(root, { recursive: true, force: true })
})

describe('parseEnv / REPORTS_ROOT', () => {
  it('acepta una ruta válida y la devuelve resuelta a absoluta', () => {
    const env = parseEnv({ REPORTS_ROOT: root })
    expect(env.REPORTS_ROOT).toBe(path.resolve(root))
  })

  it('lanza EnvError con mensaje claro si la ruta no existe', () => {
    const missing = path.join(root, 'no-existe')
    expect(() => parseEnv({ REPORTS_ROOT: missing })).toThrow(EnvError)
    expect(() => parseEnv({ REPORTS_ROOT: missing })).toThrow(/no existe/)
  })

  it('lanza EnvError con mensaje claro si la variable falta del entorno', () => {
    expect(() => parseEnv({})).toThrow(EnvError)
    expect(() => parseEnv({})).toThrow(/REPORTS_ROOT no está definida/)
  })

  it('lanza error claro si la ruta es un fichero y no un directorio', () => {
    const file = path.join(root, 'fichero.txt')
    writeFileSync(file, 'contenido')
    expect(() => parseEnv({ REPORTS_ROOT: file })).toThrow(/no es un directorio/)
  })

  it('lanza error claro si el directorio no es escribible', () => {
    chmodSync(root, 0o555) // sin bit de escritura para el dueño
    expect(() => parseEnv({ REPORTS_ROOT: root })).toThrow(/no es escribible/)
  })
})
