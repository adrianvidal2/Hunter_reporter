import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveSafeAllowMissing } from '@/core/fs/paths'
import { getEnv } from '@/lib/env'
import { programParser, type Program } from './types'

/**
 * Carga los datos del programa de un proyecto desde su FICHERO local
 * `<proyecto>/programa.json` (respuesta real de `GET /programs/{slug}`).
 * Solo fs + parser: NO hace llamadas a la API de YesWeHack.
 *
 * El fixture anonimizado (`docs/fixtures/ywh/program-detail.json`) queda
 * SOLO para los tests, no para la UI.
 */

/** Ruta segura (dentro del root) del `programa.json` de un proyecto. */
export function projectProgramPath(
  project: string,
  root: string = getEnv().REPORTS_ROOT,
): string {
  return resolveSafeAllowMissing(join(project, 'programa.json'), root)
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

/** Lee el `programa.json` de un proyecto (null si no existe). */
export function readProjectProgram(
  project: string,
  root: string = getEnv().REPORTS_ROOT,
): Program | null {
  return readProgramFile(projectProgramPath(project, root))
}
