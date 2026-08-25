'use server'

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { getEnv } from '@/lib/env'
import { writeAtomic } from '@/core/fs/atomic'
import { resolveSafe, resolveSafeAllowMissing } from '@/core/fs/paths'
import { buildProgramInfoMd } from '@/core/ywh/build-info'
import { readProgramFile } from '@/core/ywh/program-file'
import { loadOrcaSettings } from '@/core/orca/settings'
import { runOrcaLaunch } from '@/core/orca/runner'
import { appendLaunch } from '@/server/launches'

/**
 * Launcher de programa (pestaña Programa): persiste `pentest/info.md` con
 * el scope marcado + credenciales de test + motor elegido (solo recopila;
 * NO ejecuta ningún motor).
 */

// ── info.md (recopilación) ──────────────────────────────────────────────

export interface LaunchProgramInput {
  project: string
  selectedScopes: string[]
  username: string
  password: string
  engine: string
}

export type LaunchProgramResult =
  | { ok: true; relPath: string }
  | { ok: false; error: string }

export async function launchProgramAction(input: LaunchProgramInput): Promise<LaunchProgramResult> {
  const root = getEnv().REPORTS_ROOT
  try {
    // Lee programa.json del proyecto (null → Sin datos)
    let program
    try {
      const file = resolveSafeAllowMissing(path.join(input.project, 'programa.json'), root)
      program = readProgramFile(file)
    } catch {
      program = null
    }
    if (!program) {
      return { ok: false, error: 'Sin datos del programa para este proyecto.' }
    }

    const md = buildProgramInfoMd(program, {
      selectedScopes: input.selectedScopes,
      username: input.username,
      password: input.password,
    })

    // pentest/ local dentro del proyecto (resolución segura)
    const base = resolveSafeAllowMissing(path.join(input.project, 'pentest'), root)
    const { mkdirSync } = await import('node:fs')
    mkdirSync(base, { recursive: true })

    const rel = path.join(input.project, 'pentest', 'info.md')
    writeAtomic(rel, md, { root })

    revalidatePath('/')
    revalidatePath(`/proyectos/${encodeURIComponent(input.project)}`)
    return { ok: true, relPath: rel }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

// ── Modo Orca (proveedor Pi; versión mínima) ────────────────────────────

/** Avísos amables para los fallos conocidos de Orca. */
const ORCA_AVISOS: Record<string, string> = {
  repo_not_found: 'Registra la carpeta en Orca primero (Abrir como carpeta).',
  unknown_agent: 'Configuración de Orca: agente desconocido (esperado «pi»). Revisa Ajustes.',
}

export interface LaunchOrcaInput {
  project: string
  selectedScopes: string[]
  mode: 'orca'
  /** Prompt final (tal cual, sin transformar). */
  prompt: string
}

export type LaunchOrcaResult =
  | {
      ok: true
      worktreeId?: string
      handle?: string
      agentTerminalHandle?: string
      opened: boolean
      note?: string
    }
  | { ok: false; error: string; kind?: string }

/**
 * Lanza un worktree de Orca con el proveedor pi y el prompt del asistente.
 * No lanza excepciones internas: SIEMPRE devuelve un resultado plano.
 */
export async function launchOrcaAction(input: LaunchOrcaInput): Promise<LaunchOrcaResult> {
  const root = getEnv().REPORTS_ROOT
  try {
    // Slug del programa (para --name <slug>-pi-<timestamp>)
    let slug = input.project
    try {
      const file = resolveSafeAllowMissing(path.join(input.project, 'programa.json'), root)
      const program = readProgramFile(file)
      if (program?.slug) slug = program.slug
    } catch {
      // proyecto sin programa.json: usamos el nombre del proyecto
    }

    // Ruta REAL de la carpeta del proyecto (para --repo path:<carpeta>)
    const repoPath = resolveSafe(input.project, root)

    const { orcaBin } = loadOrcaSettings()
    const worktreeName = `${slug}-pi-${Date.now()}`

    // Ejecución (status → open si hace falta → worktree create)
    const outcome = await runOrcaLaunch({
      bin: orcaBin,
      repoPath,
      worktreeName,
      prompt: input.prompt,
    })

    if (!outcome.ok) {
      const aviso =
        (outcome.kind !== 'other' && ORCA_AVISOS[outcome.kind]) ||
        outcome.message ||
        'No se pudo lanzar Orca.'
      appendLaunch(input.project, {
        timestamp: Date.now(),
        provider: 'pi',
        scopeSeleccionado: input.selectedScopes,
        mode: 'orca',
        ok: false,
        error: aviso,
      })
      return { ok: false, error: aviso, kind: outcome.kind }
    }

    appendLaunch(input.project, {
      timestamp: Date.now(),
      provider: 'pi',
      scopeSeleccionado: input.selectedScopes,
      mode: 'orca',
      worktreeId: outcome.worktreeId,
      handle: outcome.handle,
      agentTerminalHandle: outcome.agentTerminalHandle,
      ok: true,
    })

    revalidatePath('/')
    revalidatePath(`/proyectos/${encodeURIComponent(input.project)}`)
    return {
      ok: true,
      worktreeId: outcome.worktreeId,
      handle: outcome.handle,
      agentTerminalHandle: outcome.agentTerminalHandle,
      opened: outcome.opened,
      note: outcome.opened ? 'Orca no estaba abierto: se abrió y se esperó al runtime.' : undefined,
    }
  } catch (err) {
    appendLaunch(input.project, {
      timestamp: Date.now(),
      provider: 'pi',
      scopeSeleccionado: input.selectedScopes,
      mode: 'orca',
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    })
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}
