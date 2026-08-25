import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from '../../lib/env'
import { writeAtomic } from '../fs/atomic'
import { createProject } from '../fs/projects'
import { renderProgramMarkdown } from './render'
import type { Program } from './types'

/**
 * Artefactos del programa en el proyecto local (9.6 ampliado):
 *
 *   <root>/<slug>/pentest/
 *   ├── programa.md     ← generado desde el detalle (74 campos)
 *   └── programa.json   ← respuesta CRUD de la API
 *
 * - `pentest/` NO la vigila el watcher (solo reportes/ e _inbox/ emiten).
 * - programa.md NO se sobrescribe si existe (puede llevar ediciones tuyas):
 *   las siguientes generaciones van a programa-<fecha>.md.
 * - programa.json es el último fetch: se actualiza siempre.
 * - El proyecto se crea con createProject (idempotente, no destructivo con
 *   tus otras carpetas).
 */

export interface ProgramArtifactsResult {
  /** Ruta relativa al root del md escrito. */
  mdRelPath: string
  jsonRelPath: string
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
  slug: string,
  program: Program,
  raw: unknown,
  root: string = getEnv().REPORTS_ROOT,
): ProgramArtifactsResult {
  const projDir = createProject(slug, root) // asegura REPORTES_YWH/ + reportes/ sin tocar nada más
  mkdirSync(path.join(projDir, 'pentest'), { recursive: true })

  // JSON crudo del último fetch (siempre fresco, atómico)
  const jsonRelPath = `${slug}/pentest/programa.json`
  writeAtomic(jsonRelPath, JSON.stringify(raw, null, 2) + '\n', { root })

  // MD generado: NO sobrescribir el existente (ediciones tuyas)
  const mainRel = `${slug}/pentest/programa.md`
  const preservedExisting = existsSync(path.join(projDir, 'pentest', 'programa.md'))
  const mdRelPath = preservedExisting
    ? `${slug}/pentest/programa-${fileTimestamp()}.md`
    : mainRel
  writeAtomic(mdRelPath, renderProgramMarkdown(program), { root })

  return { mdRelPath, jsonRelPath, preservedExisting }
}
