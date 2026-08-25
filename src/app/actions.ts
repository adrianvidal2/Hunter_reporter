'use server'

import { revalidatePath } from 'next/cache'
import { statSync } from 'node:fs'
import { writeAtomic } from '@/core/fs/atomic'
import { saveHistoryCopy } from '@/core/fs/history'
import { ConflictError, moveFile } from '@/core/fs/move'
import { PathEscapeError, resolveSafe } from '@/core/fs/paths'
import {
  InvalidProjectNameError,
  createProject,
  projectStructureExists,
} from '@/core/fs/projects'
import { trashFile } from '@/core/fs/trash'
import { listProjects } from '@/core/fs/tree'
import { resolvePending } from '@/db/pending'
import { runRewriteFor } from '@/server/rewrite'
import { notifyPendingCount } from '@/server/watcher-service'
import { getEnv } from '@/lib/env'

/**
 * Server Action: crear proyecto desde la UI (paso 3.4).
 *
 * La validación real está en createProject (núcleo): aquí solo se mapean
 * los errores a mensajes para el formulario y se refresca el dashboard.
 */

export interface CreateProjectState {
  ok: boolean
  error?: string
  /** Nombre del proyecto creado (para feedback y limpiar el input). */
  created?: string
}

export async function createProjectAction(
  _prev: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const name = String(formData.get('name') ?? '')

  try {
    createProject(name, getEnv().REPORTS_ROOT)
  } catch (err) {
    if (err instanceof InvalidProjectNameError) {
      return { ok: false, error: err.message }
    }
    console.error('createProjectAction:', err)
    return { ok: false, error: 'No se pudo crear el proyecto (error inesperado)' }
  }

  revalidatePath('/')
  return { ok: true, created: name }
}

// (ProjectExistsError ya no existe: createProject es idempotente según la
// aclaración del bloque 9; el duplicado no rompe nada.)

/** Resultado común de las acciones de fichero (3.5/3.6). */
export interface ActionResult {
  ok: boolean
  error?: string
  /** 4.7: el fichero cambió fuera del editor → se avisa y NO se escribe. */
  conflict?: boolean
  /** 4.6/4.7: mtime del fichero tras la escritura (nueva línea base). */
  mtimeMs?: number
}

/** Rutas de fichero válidas para las acciones: proyecto/carpeta/nombre. */
const FILE_PATH_RE = /^[^/]+\u002f[^/]+\u002f[^/]+$/

/**
 * Server Action: guardar un borrador (4.6). Escribe atómicamente con
 * writeAtomic. Solo admite .md dentro de reportes/ — lo único editable.
 *
 * 4.7 ⚠️: `knownMtimeMs` es el mtime que el editor vio al cargar (o tras su
 * último guardado). Si no coincide con el disco actual, el fichero cambió
 * fuera del editor: se AVISA y NO se sobrescribe (se devuelve conflict).
 */
export async function saveFileAction(
  relPath: string,
  content: string,
  knownMtimeMs?: number,
): Promise<ActionResult> {
  if (!FILE_PATH_RE.test(relPath)) {
    return { ok: false, error: 'Ruta de fichero no válida' }
  }
  const segments = relPath.split('/')
  if (segments[1] !== 'reportes' || !relPath.toLowerCase().endsWith('.md')) {
    return { ok: false, error: 'Solo se guardan borradores .md dentro de reportes/' }
  }

  try {
    const absPath = resolveSafe(relPath, getEnv().REPORTS_ROOT)
    const current = Math.round(statSync(absPath).mtimeMs)

    if (knownMtimeMs !== undefined && Math.round(knownMtimeMs) !== current) {
      return {
        ok: false,
        conflict: true,
        error:
          'El fichero cambió fuera del editor (¿otra ventana, otro proceso?). ' +
          'No se ha sobrescrito: recarga para ver la versión nueva o descarta tus cambios.',
      }
    }

    // 4.8: archivar el contenido ACTUAL en .history/ ANTES de sobrescribir
    saveHistoryCopy(relPath, getEnv().REPORTS_ROOT)

    writeAtomic(relPath, content, { root: getEnv().REPORTS_ROOT })
    // mtime real tras el rename: la nueva línea base del editor
    return { ok: true, mtimeMs: Math.round(statSync(absPath).mtimeMs) }
  } catch (err) {
    if (err instanceof PathEscapeError) return { ok: false, error: err.message }
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, error: 'El fichero ya no existe en disco' }
    }
    console.error('saveFileAction:', err)
    return { ok: false, error: 'No se pudo guardar (error inesperado)' }
  }
}

/**
 * Server Action: descartar un pendiente (6.4). Cierra el flujo: nada se
 * ejecuta jamás sobre un reporte descartado.
 */
export async function discardPendingAction(path: string): Promise<ActionResult> {
  if (!resolvePending(path, 'discarded')) {
    return { ok: false, error: 'Ese reporte ya no está pendiente' }
  }
  revalidatePath('/pendientes')
  notifyPendingCount()
  return { ok: true }
}

/**
 * Server Action: aprobar para reescritura (6.4/6.5). Marca 'approved' y
 * atraviesa el guard de runRewriteFor; sin executor (LLM = bloque 8)
 * devuelve ran:false con motivo — la aprobación queda registrada.
 */
export async function approvePendingAction(
  path: string,
): Promise<ActionResult & { note?: string }> {
  if (!resolvePending(path, 'approved')) {
    return { ok: false, error: 'Ese reporte ya no está pendiente' }
  }
  try {
    const { ran, reason } = await runRewriteFor(path)
    revalidatePath('/pendientes')
    notifyPendingCount()
    return { ok: true, note: ran ? undefined : reason }
  } catch (err) {
    console.error('approvePendingAction:', err)
    return { ok: false, error: 'No se pudo procesar la aprobación' }
  }
}

/**
 * Server Action: mover un fichero a otro proyecto (3.5). El fichero conserva
 * su carpeta de clase: pdf → REPORTES_YWH, resto → reportes.
 */
export async function moveFileAction(
  relPath: string,
  targetProject: string,
): Promise<ActionResult> {
  if (!FILE_PATH_RE.test(relPath)) {
    return { ok: false, error: 'Ruta de fichero no válida' }
  }
  const root = getEnv().REPORTS_ROOT
  const [sourceProject, , fileName] = relPath.split('/') as [string, string, string]

  try {
    if (!listProjects(root).includes(targetProject)) {
      return { ok: false, error: `El proyecto «${targetProject}» no existe` }
    }
    const targetDir = fileName.toLowerCase().endsWith('.pdf') ? 'REPORTES_YWH' : 'reportes'
    moveFile(relPath, `${targetProject}/${targetDir}/${fileName}`, { root })
  } catch (err) {
    if (err instanceof ConflictError) {
      return { ok: false, error: `Ya existe «${fileName}» en ${targetProject}` }
    }
    if (err instanceof PathEscapeError) return { ok: false, error: err.message }
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, error: 'El fichero ya no existe (¿se movió fuera de la app?)' }
    }
    console.error('moveFileAction:', err)
    return { ok: false, error: 'No se pudo mover el fichero (error inesperado)' }
  }

  revalidatePath('/')
  revalidatePath(`/proyectos/${encodeURIComponent(sourceProject)}`)
  revalidatePath(`/proyectos/${encodeURIComponent(targetProject)}`)
  return { ok: true }
}

/**
 * Server Action: eliminar un fichero (3.6). NUNCA unlink: va a .trash/.
 */
export async function deleteFileAction(relPath: string): Promise<ActionResult> {
  if (!FILE_PATH_RE.test(relPath)) {
    return { ok: false, error: 'Ruta de fichero no válida' }
  }
  const sourceProject = relPath.split('/')[0]!

  try {
    trashFile(relPath, getEnv().REPORTS_ROOT)
  } catch (err) {
    if (err instanceof PathEscapeError) return { ok: false, error: err.message }
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, error: 'El fichero ya no existe' }
    }
    console.error('deleteFileAction:', err)
    return { ok: false, error: 'No se pudo eliminar (error inesperado)' }
  }

  revalidatePath('/')
  revalidatePath(`/proyectos/${encodeURIComponent(sourceProject)}`)
  return { ok: true }
}

/** Resultado de eliminar un proyecto. */
export interface DeleteProjectResult {
  ok: boolean
  error?: string
}

/**
 * Server Action: eliminar UN proyecto (por nombre, nunca otros).
 * Mueve `reportes/<proyecto>/` ENTERO a `.trash/` (rename; recuperable) —
 * puede contener reportes/borradores. La confirmación con el nombre vive
 * en la UI (el server recibe el nombre y valida que sea un proyecto real).
 */
export async function deleteProjectAction(project: string): Promise<DeleteProjectResult> {
  const root = getEnv().REPORTS_ROOT
  try {
    const valid = listProjects(root)
    if (!valid.includes(project)) {
      return { ok: false, error: `«${project}» no es un proyecto de esta carpeta.` }
    }
    // trashFile mueve el directorio (rename): mismo patrón recuperable.
    trashFile(project, root)
    revalidatePath('/')
    return { ok: true }
  } catch (err) {
    if (err instanceof PathEscapeError) return { ok: false, error: err.message }
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, error: 'El proyecto ya no existe' }
    }
    console.error('deleteProjectAction:', err)
    return { ok: false, error: 'No se pudo eliminar el proyecto (error inesperado)' }
  }
}
