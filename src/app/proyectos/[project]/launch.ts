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
import { createOrcaWorktreeRun, prepareOrcaRun, defaultExec } from '@/core/orca/runner'
import { appendLaunch } from '@/server/launches'
import { type LaunchAgent } from '@/core/ywh/launch-form'

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

// ── Modo Orca (todos los proveedores; un worktree por proveedor) ────────

/** Avísos amables para los fallos conocidos de Orca. */
const ORCA_AVISOS: Record<string, string> = {
  repo_not_found: 'Registra la carpeta en Orca primero (Abrir como carpeta).',
  unknown_agent: 'Configuración de Orca: agente desconocido. Revisa Ajustes.',
}

export interface LaunchOrcaInput {
  project: string
  selectedScopes: string[]
  mode: 'orca'
  /** Agentes (paso 2): provider + prompt por agente + label. */
  agents: LaunchAgent[]
}

/** Resultado del worktree de UN agente. */
export interface OrcaProviderResult {
  /** label del agente ("Pi #1"). */
  label: string
  provider: string
  ok: boolean
  worktreeId?: string
  handle?: string
  agentTerminalHandle?: string
  error?: string
  kind?: string
}

export type LaunchOrcaResult =
  | {
      ok: true
      /** Resultado por agente lanzado (aislado, unos no abortan otros). */
      providers: OrcaProviderResult[]
      opened: boolean
      note?: string
    }
  | { ok: false; error: string; kind?: string }

/**
 * Lanza un worktree de Orca por CADA AGENTE (varios del mismo provider son
 * agentes distintos, cada uno con SU prompt). La preparación
 * (status→open→registro de carpeta) se hace UNA vez; un agente que falle
 * NO aborta el resto. launches.json: una entrada por agente con su prompt
 * ENTERO y su worktreeId. No lanza excepciones internas.
 */
export async function launchOrcaAction(input: LaunchOrcaInput): Promise<LaunchOrcaResult> {
  const root = getEnv().REPORTS_ROOT
  try {
    // Slug del programa (para --name <slug>-<prov>-<timestamp>)
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

    const agents = input.agents.filter((a) => a.provider !== '')
    if (agents.length === 0) {
      return { ok: false, error: 'Selecciona al menos un agente para lanzar.' }
    }
    for (const a of agents) {
      if (a.prompt.trim() === '') {
        return { ok: false, error: `El prompt de «${a.label}» no puede estar vacío.` }
      }
    }

    // Preparación compartida UNA vez (status → open si falta → registrar)
    const prep = await prepareOrcaRun(
      { bin: orcaBin, repoPath },
      { sleepMs: 1500, openTimeoutMs: 60_000 },
    )
    if (!prep.ok) {
      const aviso =
        (prep.kind !== 'other' && ORCA_AVISOS[prep.kind]) || prep.message || 'No se pudo abrir Orca.'
      for (const a of agents) {
        appendLaunch(input.project, {
          timestamp: Date.now(), provider: a.provider, label: a.label, prompt: a.prompt,
          scopeSeleccionado: input.selectedScopes, mode: 'orca', ok: false, error: aviso,
        })
      }
      return { ok: false, error: aviso, kind: prep.kind }
    }

    // Un worktree por agente; cada uno agrega su registro a launches.
    const providers: OrcaProviderResult[] = []
    for (const agent of agents) {
      const provider = agent.provider
      const worktreeName = `${slug}-${provider}-${Date.now()}`
      const outcome = await createOrcaWorktreeRun(
        { bin: orcaBin, repoPath, worktreeName, prompt: agent.prompt, agent: provider },
        defaultExec,
      )

      if (!outcome.ok) {
        const aviso =
          (outcome.kind === 'unknown_agent'
            ? `id de agente no válido en Orca para «${agent.label}» (${provider}). Revisa Ajustes.`
            : (outcome.kind !== 'other' && ORCA_AVISOS[outcome.kind]) || outcome.message || 'No se pudo lanzar Orca.')
        appendLaunch(input.project, {
          timestamp: Date.now(), provider, label: agent.label, prompt: agent.prompt,
          scopeSeleccionado: input.selectedScopes, mode: 'orca', ok: false, error: aviso,
        })
        providers.push({ label: agent.label, provider, ok: false, error: aviso, kind: outcome.kind })
        continue
      }

      appendLaunch(input.project, {
        timestamp: Date.now(), provider, label: agent.label, prompt: agent.prompt,
        scopeSeleccionado: input.selectedScopes, mode: 'orca',
        worktreeId: outcome.worktreeId, handle: outcome.handle, agentTerminalHandle: outcome.agentTerminalHandle,
        ok: true,
      })
      providers.push({ label: agent.label, provider, ok: true, worktreeId: outcome.worktreeId, handle: outcome.handle, agentTerminalHandle: outcome.agentTerminalHandle })
    }

    revalidatePath('/')
    revalidatePath(`/proyectos/${encodeURIComponent(input.project)}`)
    return {
      ok: true,
      providers,
      opened: prep.opened,
      note: prep.opened ? 'Orca no estaba abierto: se abrió y se esperó al runtime.' : undefined,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado'
    for (const a of input.agents ?? []) {
      appendLaunch(input.project, {
        timestamp: Date.now(), provider: a.provider, label: a.label, prompt: a.prompt,
        scopeSeleccionado: input.selectedScopes, mode: 'orca', ok: false, error: msg,
      })
    }
    return { ok: false, error: msg }
  }
}
