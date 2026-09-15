import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { resolveSafeAllowMissing } from '@/core/fs/paths'
import { writeAtomic } from '@/core/fs/atomic'
import { getEnv } from '@/lib/env'
import { programParser, type Program } from './types'

/**
 * Carga los datos del programa de un proyecto desde su `programa.json`
 * (respuesta real de `GET /programs/{slug}`). Solo fs + parser: NO hace
 * llamadas a la API de YesWeHack.
 *
 * Ruta canónica: `<proyecto>/pentest/programa.json` (donde también escribe
 * writeProgramArtifacts). LECTURA RETROCOMPATIBLE: los proyectos heredados
 * de antes de `pentest/` lo tenían SUELTO en la raíz — si no está en
 * `pentest/` pero sí en la raíz, se lee, se MUEVE a `pentest/` y se borra
 * el de la raíz en el mismo paso (mismo patrón que platform.json).
 *
 * El fixture anonimizado (`docs/fixtures/ywh/program-detail.json`) queda
 * SOLO para los tests, no para la UI.
 */

/** Ruta segura (dentro del root) del `programa.json` canónico: `pentest/`. */
export function projectProgramPath(
  project: string,
  root: string = getEnv().REPORTS_ROOT,
): string {
  return resolveSafeAllowMissing(join(project, 'pentest/programa.json'), root)
}

/** Ruta LEGACY: `programa.json` suelto en la raíz del proyecto. */
export function legacyProjectProgramPath(
  project: string,
  root: string = getEnv().REPORTS_ROOT,
): string {
  return resolveSafeAllowMissing(join(project, 'programa.json'), root)
}

/** Junta relativa al root con separadores del sistema. */
function join(...parts: string[]): string {
  return parts.join('/')
}

/** Lee y parsea el fichero en la ruta dada; `null` si falta o no parsea. */
export function readProgramFile(path: string): Program | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return programParser.parse(raw)
  } catch {
    return null
  }
}

/**
 * Lee el `programa.json` de un proyecto (null si no existe). Retrocompatible:
 * si solo existe el legacy de la raíz, lo migra a `pentest/` al leerlo.
 */
export function readProjectProgram(
  project: string,
  root: string = getEnv().REPORTS_ROOT,
): Program | null {
  const canonical = readProgramFile(projectProgramPath(project, root))
  if (canonical) return canonical

  const legacyPath = legacyProjectProgramPath(project, root)
  if (!existsSync(legacyPath)) return null
  try {
    const text = readFileSync(legacyPath, 'utf8')
    const parsed = programParser.parse(JSON.parse(text) as unknown) // valida ANTES de mover
    mkdirSync(path.dirname(projectProgramPath(project, root)), { recursive: true })
    writeAtomic(join(project, 'pentest/programa.json'), text, { root })
    rmSync(legacyPath)
    return parsed
  } catch {
    return null // legacy corrupto: no se toca nada
  }
}

/**
 * Escribe `pentest/programa.json` con la respuesta de `GET /programs/{slug}`
 * (cruda, el mismo esquema que parsea la pestaña Programa). Atómico; la
 * carpeta del proyecto se crea si falta. Fuera de git.
 */
export function writeProjectProgramRaw(
  project: string,
  raw: unknown,
  root: string = getEnv().REPORTS_ROOT,
): string {
  // asegurar que el directorio del proyecto existe (writeAtomic lo requiere)
  mkdirSync(path.dirname(projectProgramPath(project, root)), { recursive: true })
  writeAtomic(join(project, 'pentest/programa.json'), JSON.stringify(raw, null, 2) + '\n', { root })
  return projectProgramPath(project, root)
}
