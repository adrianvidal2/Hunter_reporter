import { readdirSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from '../../lib/env'
import { PathEscapeError, resolveSafe } from './paths'
import { naturalCompare } from './sorting'

/**
 * Lectura del árbol de reportes (paso 1.4+).
 *
 * El sistema de ficheros es la verdad: estas funciones no leen ningún índice,
 * solo el disco.
 */

/** Carpetas de primer nivel que no son proyectos. */
const NON_PROJECT_DIRS = new Set(['_inbox'])

/**
 * Proyectos de primer nivel dentro de REPORTS_ROOT: directorios, ignorando
 * dotfiles (`.trash`, `.cache`, …) y `_inbox`. Devueltos ordenados.
 *
 * Con `withFileTypes`, `isDirectory()` es falso para symlinks: un enlace a
 * un directorio no se lista como proyecto (coherente con resolveSafe, que
 * los habría aceptado; aquí preferimos no mostrar lo que no es un directorio
 * real gestionado por la app).
 */
export function listProjects(root: string = getEnv().REPORTS_ROOT): string[] {
  const realRoot = realpathSync(root)
  return readdirSync(realRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !NON_PROJECT_DIRS.has(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
}

/** Fichero de un proyecto, tal y como lo consume la UI (3.2/3.3). */
export interface FileEntry {
  name: string
  /** Ruta relativa a REPORTS_ROOT con separadores '/' (lista para resolveSafe). */
  relPath: string
  /** Bytes. */
  size: number
  /** mtime en ms (para ordenar por fecha en 3.3). */
  mtimeMs: number
}

export interface ProjectListing {
  project: string
  /** PDFs de `REPORTES_YWH/`, ordenados por nombre (orden natural). */
  delivered: FileEntry[]
  /** Markdown de `reportes/`, ordenados por nombre (orden natural). */
  drafts: FileEntry[]
}

const DELIVERED_DIR = 'REPORTES_YWH'
const DRAFTS_DIR = 'reportes'

/**
 * Lista los ficheros de un proyecto: PDFs entregados y borradores markdown.
 *
 * - `project` debe ser UN segmento (sin separadores): se valida con
 *   resolveSafe y se rechaza cualquier intento de anidar.
 * - Las subcarpetas del proyecto que no existan cuentan como vacías:
 *   un proyecto recién creado aún no tiene `REPORTES_YWH/` ni `reportes/`.
 * - Se ignoran dotfiles (`.DS_Store`, `.tmp` de writeAtomic…), directorios
 *   y ficheros sin la extensión esperada de cada carpeta.
 */
export function listProject(
  project: string,
  root: string = getEnv().REPORTS_ROOT,
): ProjectListing {
  if (/[/\\]/.test(project) || project === '..' || project.includes('\0')) {
    throw new PathEscapeError(
      `el nombre de proyecto debe ser un único segmento: ${JSON.stringify(project)}`,
    )
  }

  const projectDir = resolveSafe(project, root)
  const toEntries = (dirName: string, ext: string): FileEntry[] => {
    const absDir = path.join(projectDir, dirName)
    let entries
    try {
      entries = readdirSync(absDir, { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    return entries
      .filter(
        (e) => e.isFile() && !e.name.startsWith('.') && e.name.toLowerCase().endsWith(ext),
      )
      .map((e) => {
        const st = statSync(path.join(absDir, e.name))
        return {
          name: e.name,
          relPath: `${project}/${dirName}/${e.name}`,
          size: st.size,
          mtimeMs: st.mtimeMs,
        }
      })
      // Orden natural único de la app: naturalCompare (unificado con sorting.ts)
      .sort((a, b) => naturalCompare(a.name, b.name))
  }

  return {
    project,
    delivered: toEntries(DELIVERED_DIR, '.pdf'),
    drafts: toEntries(DRAFTS_DIR, '.md'),
  }
}
