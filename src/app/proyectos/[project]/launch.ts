'use server'

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
import { renderKbContext } from '@/core/kb/kb'
import { buildMission } from '@/core/recon/mission'
import { deriveDeterministicPrimitives } from '@/core/recon/primitives'
import { readHarvestArtifacts } from '@/server/derive-primitives'
import { listKbIndex, loadKbEntry } from '@/core/kb/kb'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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

// ── Contexto KB para el wizard Lanzar (Tarea 6c) ──────────────────────

/**
 * Contexto markdown de las skills KB marcadas en el asistente (solo lectura;
 * el ensamblado con el prompt lo hace el wizard con applyKbToPrompt).
 */
export async function renderKbContextAction(
  slugs: string[],
  project?: string,
): Promise<{ ok: true; context: string } | { ok: false; error: string }> {
  try {
    return { ok: true, context: renderKbContext(slugs, { project: project || undefined }) }
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

// ── Semilla de misión (Tarea 7e): ensamblar ≠ ejecutar ──────────────────

export interface BuildMissionResult {
  ok: boolean
  error?: string
  /** El prompt de misión ensamblado (lo lanza el HUMANO desde Lanzar). */
  mission?: string
  /** Dir de harvest usado (relativo a REPORTS_ROOT). */
  harvestDirRel?: string
}

/**
 * Ensambla la misión del agente: el prompt real del usuario como plantilla,
 * auto-rellenado con OpenAPI (07b) + primitivas/hipótesis (07d) + secretos
 * (07c) + cobertura/huecos (07a). SOLO ENSAMBLA: no lanza nada — el
 * worktree lo dispara el humano con launchOrcaAction.
 */
export async function buildMissionAction(
  project: string,
  harvestDirRel?: string,
): Promise<BuildMissionResult> {
  const root = getEnv().REPORTS_ROOT

  // 1) dir de harvest: el dado o el más RECIENTE con openapi.json
  let dirRel = harvestDirRel
  if (!dirRel) {
    try {
      const jsBase = resolveSafeAllowMissing(`${project}/pentest/recon/js`, root)
      const dirs = readdirSync(jsBase).sort().reverse()
      for (const d of dirs) {
        const candidate = `${project}/pentest/recon/js/${d}`
        if (existsSync(resolveSafeAllowMissing(`${candidate}/openapi.json`, root))) {
          dirRel = candidate
          break
        }
      }
    } catch {
      /* sin harvests de JS */
    }
  }
  if (!dirRel) {
    return { ok: false, error: 'No hay harvest de JS para este proyecto (ejecuta la recolección 07a-c primero)' }
  }

  let artifacts
  try {
    artifacts = readHarvestArtifacts(resolveSafe(dirRel, root))
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Ruta de harvest inválida' }
  }

  // 2) huecos de COBERTURA (JS sin sourcemap / no leídos) desde coverage.json
  let jsSinMap: string[] = []
  try {
    const coverageAbs = resolveSafe(`${dirRel}/coverage.json`, root)
    if (existsSync(coverageAbs)) {
      const cov = JSON.parse(readFileSync(coverageAbs, 'utf8')) as {
        coverage?: { url?: string; status?: string }[]
      }
      jsSinMap = (cov.coverage ?? [])
        .filter(
          (c) =>
            typeof c.url === 'string' &&
            typeof c.status === 'string' &&
            ['no-map', 'skipped-large', 'map-fetch-error', 'map-invalid'].includes(c.status),
        )
        .map((c) => c.url!)
    }
  } catch {
    /* sin coverage.json: huecos solo de gaps.json */
  }

  // 3) scope del programa.json (la misma fuente que el resto del lanzamiento)
  let scope: string[] = []
  try {
    const program = readProgramFile(resolveSafeAllowMissing(path.join(project, 'programa.json'), root))
    scope = (program?.scopes ?? []).map((s) => s.scope).filter((s): s is string => Boolean(s))
  } catch {
    /* sin programa.json: scope vacío y la misión lo dice */
  }

  // 4) hipótesis ya derivadas: entradas 07d de la KB del proyecto (js-*)
  const kb07d = listKbIndex({ project, root, category: 'tecnica' })
    .filter((e) => e.slug.startsWith('js-'))
    .slice(0, 10)
  const hipotesisTexto =
    kb07d.length > 0
      ? kb07d
          .map((e) => `#### ${e.slug}\n\n${loadKbEntry(e.slug, { project, root }).body}`)
          .join('\n\n')
      : undefined

  const mission = buildMission({
    project,
    scope,
    openapiJson: existsSync(path.join(resolveSafe(dirRel, root), 'openapi.json'))
      ? readFileSync(path.join(resolveSafe(dirRel, root), 'openapi.json'), 'utf8')
      : null,
    primitivas: deriveDeterministicPrimitives(artifacts),
    hipotesis: [],
    secretos: artifacts.secrets.filter((s) => s.confidence === 'candidato'),
    huecos: artifacts.gaps,
    jsSinMap,
    ...(hipotesisTexto !== undefined ? { hipotesisTexto } : {}),
  })

  return { ok: true, mission, harvestDirRel: dirRel }
}
