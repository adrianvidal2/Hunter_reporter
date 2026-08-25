'use server'

import { revalidatePath } from 'next/cache'
import { createProject, projectStructureExists } from '@/core/fs/projects'
import { InvalidProjectNameError } from '@/core/fs/projects'
import { writeProgramArtifacts } from '@/core/ywh/artifacts'
import { YwhClient } from '@/core/ywh/client'
import { loadYwhToken } from '@/core/ywh/token'
import type { Program } from '@/core/ywh/types'

/**
 * Server Action (9.5): detalle de un programa bajo demanda. El token NUNCA
 * cruza al cliente; solo los datos del programa.
 */
export type ProgramDetailResult =
  | { ok: true; program: Program }
  | { ok: false; error: string }

export async function getProgramAction(slug: string): Promise<ProgramDetailResult> {
  try {
    const client = new YwhClient(loadYwhToken())
    const program = await client.getProgram(slug)
    return { ok: true, program }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

/**
 * 9.6 ampliado: crear proyecto local desde un programa (nombre = slug) con
 * `pentest/` conteniendo programa.md (generado del detalle) y programa.json
 * (crudo de la API). Respeta la aclaración del bloque 9: carpetas previas
 * intactas; programa.md no se sobrescribe si ya existe (va fechado).
 */
export interface CreateFromProgramResult {
  ok: boolean
  error?: string
  projectName?: string
  alreadyExisted?: boolean
  /** Rutas de los artefactos escritos en pentest/. */
  mdPath?: string
  jsonPath?: string
  /** true si programa.md ya existía y se escribió un fechado. */
  preservedMd?: boolean
  /** true si el programa es privado (aviso NDA en pantalla y en el md). */
  privateProgram?: boolean
}

export async function createProjectFromProgramAction(slug: string): Promise<CreateFromProgramResult> {
  try {
    const client = new YwhClient(loadYwhToken())
    const { program, raw } = await client.getProgramWithRaw(slug)

    const alreadyExisted = projectStructureExists(slug)
    const artifacts = writeProgramArtifacts(slug, program, raw)

    revalidatePath('/')
    revalidatePath(`/proyectos/${encodeURIComponent(slug)}`)
    return {
      ok: true,
      projectName: slug,
      alreadyExisted,
      mdPath: artifacts.mdRelPath,
      jsonPath: artifacts.jsonRelPath,
      preservedMd: artifacts.preservedExisting,
      privateProgram: !program.public,
    }
  } catch (err) {
    if (err instanceof InvalidProjectNameError) {
      return { ok: false, error: err.message }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}
