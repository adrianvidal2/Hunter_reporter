'use server'

import { revalidatePath } from 'next/cache'
import { createProject, projectStructureExists } from '@/core/fs/projects'
import { InvalidProjectNameError } from '@/core/fs/projects'
import { writeProgramArtifacts } from '@/core/ywh/artifacts'
import { YwhApiError, YwhClient } from '@/core/ywh/client'
import { loadYwhToken, TokenExpiredError } from '@/core/ywh/token'
import { readProjectProgram, writeProjectProgramRaw } from '@/core/ywh/program-file'
import { programToNeutral, shortProgramToNeutral } from '@/core/ywh/adapter'
import { IntigritiApiError, IntigritiClient } from '@/core/intigriti/client'
import { detailToNeutral, overviewToNeutral } from '@/core/intigriti/adapter'
import { writeProgramArtifacts as writeIntigritiArtifacts } from '@/core/intigriti/artifacts'
import { loadIntigritiToken } from '@/core/intigriti/token'
import { readPlatformJson } from '@/core/programs/platform-file'
import { getEnv } from '@/lib/env'
import type { NeutralProgramDetail, NeutralProgramSummary, PlatformId } from '@/core/programs/types'

/**
 * Server Action (9.5): detalle de un programa bajo demanda. El token NUNCA
 * cruza al cliente; solo los datos del programa (en modelo neutro, con el
 * raw de YWH dentro para las vistas específicas).
 */
export type ProgramDetailResult =
  | { ok: true; program: NeutralProgramDetail }
  | { ok: false; error: string }

export async function getProgramAction(slug: string): Promise<ProgramDetailResult> {
  try {
    const client = new YwhClient(loadYwhToken())
    const program = await client.getProgram(slug)
    return { ok: true, program: programToNeutral(program) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

/** ¿El error significa sesión caducada (401) o 404 del gateway (sesión muerta)? */
function isSessionError(err: unknown): boolean {
  return err instanceof YwhApiError && (err.kind === 'auth' || err.kind === 'not_found')
}

/** Resultado de crear un proyecto desde un programa (con ingesta del detalle). */
export interface CreateProjectFromProgramResult {
  ok: boolean
  pendingSync?: boolean
  syncError?: string
  error?: string
  projectName?: string
  alreadyExisted?: boolean
  /** true si el programa es privado (aviso NDA en pantalla). */
  privateProgram?: boolean
}

/**
 * Crea el proyecto local desde un programa (nombre = slug) e INGIERE el
 * detalle de `GET /programs/{slug}` en `reportes/<proyecto>/programa.json`
 * (el mismo esquema que usa la pestaña Programa). Si el token caducó, crea
 * el proyecto pero lo marca «pendiente de sincronizar» y avisa — nunca deja
 * programa.json vacío en silencio.
 */
export async function createProjectFromProgramAction(slug: string): Promise<CreateProjectFromProgramResult> {
  try {
    const client = new YwhClient(loadYwhToken())
    const { program, raw } = await client.getProgramWithRaw(slug)

    const alreadyExisted = projectStructureExists(slug)
    writeProgramArtifacts(slug, program, raw)
    // programa.json en la raíz del proyecto (lo que lee la pestaña Programa)
    writeProjectProgramRaw(slug, raw)

    revalidatePath('/')
    revalidatePath(`/proyectos/${encodeURIComponent(slug)}`)
    return { ok: true, projectName: slug, alreadyExisted, privateProgram: !program.public }
  } catch (err) {    if (err instanceof InvalidProjectNameError) {
      return { ok: false, error: err.message }
    }
    if (isSessionError(err)) {
      // Token caducado: crea el proyecto igualmente (idempotente), marcado
      // como pendiente de sincronizar.
      try {
        createProject(slug, getEnv().REPORTS_ROOT)
      } catch {
        // si ya existía la estructura, no pasa nada
      }
      return {
        ok: true,
        pendingSync: true,
        syncError: 'Sesión caducada, renueva el token en Ajustes.',
        projectName: slug,
      }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

/**
 * Sincroniza (o rellena) el `programa.json` de un proyecto EXISTENTE con el
 * detalle de la API. Sirve para reintentar tras token caducado y para
 * proyectos viejos sin detalle (Monisnap, Globus), sin recrearlos.
 * El slug a consultar: el de su `programa.json` si existe, si no el nombre
 * del proyecto.
 */
export interface SyncProjectProgramResult {
  ok: boolean
  pendingSync?: boolean
  syncError?: string
  error?: string
}

export async function syncProjectProgramAction(project: string): Promise<SyncProjectProgramResult> {
  const root = getEnv().REPORTS_ROOT
  try {
    const existing = readProjectProgram(project, root)
    const slug = existing?.slug ?? project
    const client = new YwhClient(loadYwhToken())
    const { program, raw } = await client.getProgramWithRaw(slug)

    writeProgramArtifacts(project, program, raw, root)
    writeProjectProgramRaw(project, raw, root)

    revalidatePath('/')
    revalidatePath(`/proyectos/${encodeURIComponent(project)}`)
    return { ok: true }
  } catch (err) {
    if (isSessionError(err)) {
      return { ok: false, pendingSync: true, syncError: 'Sesión caducada, renueva el token en Ajustes.' }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}
// ── Paso 4: subpestanas por plataforma ─────────────────────────────────
// Cada subpestana (YesWeHack | Intigriti) carga SU lista al pulsarla, con
// su propia búsqueda y filtros en el cliente. Nada compartido entre ellas:
// aquí solo viven las llamadas de servidor por plataforma.

export type ProgramsListResult =
  | { ok: true; programs: NeutralProgramSummary[]; hasToken: boolean; privateCount: number }
  | { ok: false; error: string; tokenProblem?: boolean }

/** Lista YWH (subpestana YesWeHack): se llama SOLO al activar la pestaña. */
export async function getYwhProgramsAction(): Promise<ProgramsListResult> {
  const token = loadYwhToken()
  try {
    const { items } = await new YwhClient(token).fetchAllPrograms()
    return {
      ok: true,
      programs: items.map(shortProgramToNeutral),
      hasToken: token !== null,
      privateCount: items.filter((p) => !p.public).length,
    }
  } catch (err) {
    return {
      ok: false,
      tokenProblem:
        err instanceof TokenExpiredError ||
        (err instanceof YwhApiError && err.kind === 'auth'),
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}

export type IntigritiListResult =
  | { ok: true; programs: NeutralProgramSummary[] }
  /** Sin PAT configurado: la subpestana lo dice con enlace a Ajustes. */
  | { ok: false; reason: 'no-token' }
  | { ok: false; reason: 'error'; error: string; authProblem?: boolean }

/** Lista Intigriti (subpestana Intigriti): se llama SOLO al activar la pestaña. */
export async function getIntigritiProgramsAction(): Promise<IntigritiListResult> {
  const token = loadIntigritiToken()
  if (!token) return { ok: false, reason: 'no-token' }
  try {
    const { items } = await new IntigritiClient(token.pat).fetchAllPrograms()
    return { ok: true, programs: items.map(overviewToNeutral) }
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      authProblem: err instanceof IntigritiApiError && err.kind === 'auth',
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}

export type IntigritiDetailResult =
  | { ok: true; program: NeutralProgramDetail }
  | { ok: false; reason: 'no-token' }
  | { ok: false; reason: 'error'; error: string }

/** Detalle Intigriti bajo demanda (por programId, uuid). */
export async function getIntigritiProgramAction(programId: string): Promise<IntigritiDetailResult> {
  const token = loadIntigritiToken()
  if (!token) return { ok: false, reason: 'no-token' }
  try {
    const client = new IntigritiClient(token.pat)
    const program = await client.getProgram(programId)
    return { ok: true, program: detailToNeutral(program) }
  } catch (err) {
    return { ok: false, reason: 'error', error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

/** Resultado de crear un proyecto desde un programa Intigriti. */
export interface CreateProjectFromIntigritiResult {
  ok: boolean
  error?: string
  projectName?: string
  alreadyExisted?: boolean
  /** true si el programa no es público (aviso NDA en pantalla). */
  privateProgram?: boolean
}

/**
 * Crea el proyecto local desde un programa Intigriti (nombre = handle) e
 * ingiere pentest/programa.md (render propio), pentest/programa.json (crudo)
 * y platform.json (paso 4).
 */
export async function createProjectFromIntigritiProgramAction(
  programId: string,
): Promise<CreateProjectFromIntigritiResult> {
  try {
    const token = loadIntigritiToken()
    if (!token) return { ok: false, error: 'Sin PAT de Intigriti: configúralo en Ajustes.' }

    const client = new IntigritiClient(token.pat)
    const { program, raw } = await client.getProgramWithRaw(programId)
    const name = program.handle || program.id

    const alreadyExisted = projectStructureExists(name)
    writeIntigritiArtifacts(name, program, raw)

    revalidatePath('/')
    revalidatePath(`/proyectos/${encodeURIComponent(name)}`)
    return {
      ok: true,
      projectName: name,
      alreadyExisted,
      privateProgram: (program.confidentialityLevel?.value ?? '').toLowerCase() !== 'public',
    }
  } catch (err) {
    if (err instanceof InvalidProjectNameError) {
      return { ok: false, error: err.message }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

// ── Punto 2: «Actualizar datos del programa» en la pestaña Programa ────

export interface RefreshProgramResult {
  ok: boolean
  error?: string
  pendingSync?: boolean
  syncError?: string
  /** Plataforma usada (resuelta de .config/platform.json; fallback YWH). */
  platform?: PlatformId
  /** true si programa.md ya existía y el nuevo fue a programa-<fecha>.md (9.6). */
  archivedExisting?: boolean
}

/**
 * Vuelve a pedir el detalle a la plataforma del proyecto (según su
 * `.config/platform.json`; sin marca se asume YWH, herencia) y reescribe
 * `pentest/programa.json` y `pentest/programa.md`. Respeta el 9.6: si
 * programa.md ya existe (puede llevar ediciones tuyas), el nuevo va a
 * `programa-<fecha>.md`. Sirve para proyectos heredados (demo_project) y
 * para refrescar el scope cuando el programa cambie.
 */
export async function refreshProjectProgramAction(project: string): Promise<RefreshProgramResult> {
  const root = getEnv().REPORTS_ROOT
  // readPlatformJson migra en el mismo paso un legacy de la raíz si existe
  const pj = readPlatformJson(project, root)
  const platform: PlatformId = pj?.platform ?? 'yeswehack'

  try {
    if (platform === 'intigriti') {
      const token = loadIntigritiToken()
      if (!token) {
        return { ok: false, error: 'Sin PAT de Intigriti: configúralo en Ajustes.', platform }
      }
      if (!pj?.programId) {
        return { ok: false, error: 'platform.json no lleva programId: sincroniza desde la pestaña Intigriti.', platform }
      }
      const { program, raw } = await new IntigritiClient(token.pat).getProgramWithRaw(pj.programId)
      const res = writeIntigritiArtifacts(project, program, raw, root)
      revalidatePath(`/proyectos/${encodeURIComponent(project)}`)
      return { ok: true, platform, archivedExisting: res.preservedExisting }
    }

    // YWH: slug de platform.json; fallback al programa.json migrado; al nombre
    const slug = pj?.slug ?? readProjectProgram(project, root)?.slug ?? project
    const { program, raw } = await new YwhClient(loadYwhToken()).getProgramWithRaw(slug)
    const res = writeProgramArtifacts(project, program, raw, root)
    writeProjectProgramRaw(project, raw, root)
    revalidatePath('/')
    revalidatePath(`/proyectos/${encodeURIComponent(project)}`)
    return { ok: true, platform, archivedExisting: res.preservedExisting }
  } catch (err) {
    if (isSessionError(err)) {
      return { ok: false, pendingSync: true, syncError: 'Sesión caducada, renueva el token en Ajustes.', platform }
    }
    if (err instanceof IntigritiApiError && err.kind === 'auth') {
      return { ok: false, pendingSync: true, syncError: 'PAT inválido o sin permisos (401) — revisa tu token en Ajustes.', platform }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado', platform }
  }
}
