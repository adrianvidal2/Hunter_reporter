import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from '../../lib/env'
import { writeAtomic } from '../fs/atomic'
import { createProject } from '../fs/projects'
import { writePlatformJson } from '../programs/platform-file'
import { renderProgramMarkdown } from './render'
import type { ProgramDetail } from './types'

/**
 * Artefactos de un programa Intigriti en el proyecto local (paso 4),
 * espejo de core/ywh/artifacts.ts con las mismas reglas:
 *
 *   <root>/<handle>/
 *   ├── platform.json   ← marca de plataforma (paso 4)
 *   └── pentest/
 *       ├── programa.md     ← render propio de Intigriti
 *       └── programa.json   ← respuesta CRUD de la API (cruda)
 *
 * - programa.md NO se sobrescribe si existe (ediciones tuyas): las
 *   siguientes generaciones van a programa-<fecha>.md.
 * - programa.json y platform.json se actualizan siempre.
 */

export interface ProgramArtifactsResult {
  mdRelPath: string
  jsonRelPath: string
  platformRelPath: string
  /** true si programa.md ya existía y se escribió un fechado. */
  preservedExisting: boolean
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

function fileTimestamp(d = new Date()): string {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

export function writeProgramArtifacts(
  handle: string,
  program: ProgramDetail,
  raw: unknown,
  root: string = getEnv().REPORTS_ROOT,
): ProgramArtifactsResult {
  const projDir = createProject(handle, root)
  mkdirSync(path.join(projDir, 'pentest'), { recursive: true })

  const platformRelPath = writePlatformJson(handle, {
    platform: 'intigriti',
    programId: program.id,
    handle,
  }, root)

  const jsonRelPath = `${handle}/pentest/programa.json`
  writeAtomic(jsonRelPath, JSON.stringify(raw, null, 2) + '\n', { root })

  const mainRel = `${handle}/pentest/programa.md`
  const preservedExisting = existsSync(path.join(projDir, 'pentest', 'programa.md'))
  const mdRelPath = preservedExisting
    ? `${handle}/pentest/programa-${fileTimestamp()}.md`
    : mainRel
  writeAtomic(mdRelPath, renderProgramMarkdown(program), { root })

  return { mdRelPath, jsonRelPath, platformRelPath, preservedExisting }
}
