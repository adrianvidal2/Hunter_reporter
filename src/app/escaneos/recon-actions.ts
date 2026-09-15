'use server'

import { accessSync, constants, existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { getEnv } from '@/lib/env'
import { statSync } from 'node:fs'
import { resolveSafe, resolveSafeAllowMissing, PathEscapeError } from '@/core/fs/paths'
import { listProjects } from '@/core/fs/tree'
import { programParser } from '@/core/ywh/types'
import { programDetailParser } from '@/core/intigriti/types'
import { readPlatformJson } from '@/core/programs/platform-file'
import { parseHttpxHosts } from '@/core/recon/flows'
import { getTool, RECON_TOOLS } from '@/core/recon/tools'
import { loadReconSettings, saveReconSettings, resolveBinPath, type ReconSettings } from '@/core/recon/settings'
import { getReconRunner, type ReconRunRecord } from '@/server/recon-runner'

/**
 * Server Actions de la subpestana Recon (pestaña Escaneos del proyecto).
 *
 * El SERVIDOR decide siempre scope/UA/reglas leyendo `programa.json` +
 * `platform.json` del proyecto: del cliente solo llegan toolId, targets
 * marcados, confirmación y ruta opcional validada. El token/PAT jamás
 * participa aquí.
 */

export interface ReconContext {
  ok: boolean
  error?: string
  platform?: 'yeswehack' | 'intigriti'
  /** Scope in-scope, normalizado, del programa.json actual. */
  targets?: string[]
  userAgent?: string
  rulesText?: string
  automatedTooling?: number | null
  programFetchedAt?: string
}

interface RawProgram {
  slug?: string
  user_agent?: string | null
  rules?: string | null
  scopes?: { scope?: string }[] | null
  domains?: { content?: { endpoint?: string }[] } | null
  rulesOfEngagement?: {
    content?: {
      description?: string | null
      testingRequirements?: { automatedTooling?: number | null }
    }
  } | null
}

function readRawProgram(project: string, root: string): RawProgram | null {
  for (const rel of [`${project}/pentest/programa.json`, `${project}/programa.json`]) {
    try {
      const abs = resolveSafeAllowMissing(rel, root)
      const raw = JSON.parse(readFileSync(abs, 'utf8')) as RawProgram
      return raw
    } catch {
      continue
    }
  }
  return null
}

/** Scope + UA + reglas del proyecto, para el gate y las recetas. */
export async function getReconContextAction(project: string): Promise<ReconContext> {
  const root = getEnv().REPORTS_ROOT
  if (!listProjects(root).includes(project)) {
    return { ok: false, error: `No existe el proyecto: ${project}` }
  }
  const raw = readRawProgram(project, root)
  if (!raw) {
    return { ok: false, error: 'Sin programa.json: sincroniza los datos del programa primero' }
  }
  const platform = readPlatformJson(project, root)?.platform ?? 'yeswehack'

  if (platform === 'intigriti') {
    const parsed = programDetailParser.safeParse(raw)
    if (!parsed.success) return { ok: false, error: 'programa.json no tiene el formato Intigriti esperado' }
    const d = parsed.data
    return {
      ok: true,
      platform,
      targets: (d.domains?.content ?? []).map((x) => x.endpoint).filter((x): x is string => !!x),
      userAgent: d.rulesOfEngagement?.content.testingRequirements.userAgent || undefined,
      rulesText: d.rulesOfEngagement?.content.description || undefined,
      automatedTooling: d.rulesOfEngagement?.content.testingRequirements.automatedTooling ?? null,
    }
  }

  const parsed = programParser.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'programa.json no tiene el formato YWH esperado' }
  const p = parsed.data
  return {
    ok: true,
    platform: 'yeswehack',
    targets: p.scopes.map((s) => s.scope).filter(Boolean),
    userAgent: p.user_agent || undefined,
    rulesText: p.rules || undefined,
    automatedTooling: undefined, // YWH no tiene el campo: gate por texto
  }
}

export interface StartReconActionInput {
  project: string
  toolId: string
  /** Targets marcados en la UI (el runner interseca contra el scope real). */
  targets: string[]
  confirmed?: boolean
  timeoutMs?: number
  /** Solo sqlmap/dalfox: ruta opcional sobre el target seleccionado. */
  urlPath?: string
  /** Solo sqlmap/dalfox: confirmación del gate de explotación. */
}

export type StartReconActionResult =
  | { ok: true; runId: string; outputDir: string; warnings: string[] }
  | { ok: false; error: string; needsConfirmation?: boolean; verdictReason?: string; rejected?: { target: string; reason: string }[] }

/** Lanza un run de scope (todas menos sqlmap/dalfox). */
export async function startReconAction(input: StartReconActionInput): Promise<StartReconActionResult> {
  const context = await getReconContextAction(input.project)
  if (!context.ok) return { ok: false, error: context.error ?? 'Sin contexto de programa' }

  const runner = getReconRunner()
  const res = runner.start({
    project: input.project,
    toolId: input.toolId,
    targets: input.targets,
    scope: context.targets ?? [],
    userAgent: context.userAgent,
    rules: { rulesText: context.rulesText, automatedTooling: context.automatedTooling },
    confirmed: input.confirmed,
    timeoutMs: input.timeoutMs,
  })
  if (res.ok) {
    revalidatePath(`/proyectos/${encodeURIComponent(input.project)}`)
    return { ok: true, runId: res.runId, outputDir: res.outputDir, warnings: res.warnings }
  }
  return {
    ok: false,
    error: res.error,
    needsConfirmation: res.needsConfirmation,
    verdictReason: res.verdict?.reason,
    rejected: res.rejected,
  }
}

/** sqlmap/dalfox sobre UNA URL del scope (+ ruta opcional validada). */
export async function startUrlReconAction(input: {
  project: string
  toolId: string
  urlTarget: string
  urlPath?: string
  confirmed?: boolean
  timeoutMs?: number
}): Promise<StartReconActionResult> {
  const { composeUrl } = await import('@/core/recon/flows')
  const context = await getReconContextAction(input.project)
  if (!context.ok) return { ok: false, error: context.error ?? 'Sin contexto de programa' }
  // el target de la URL DEBE estar en el scope del programa
  const normalized = context.targets?.map((t) => t.toLowerCase()) ?? []
  const target = input.urlTarget.toLowerCase()
  if (!normalized.some((t) => target === t || target.startsWith(`${t}/`) || target.endsWith(`.${t}`))) {
    return { ok: false, error: 'La URL no está en el scope del programa' }
  }

  let url: string
  try {
    url = composeUrl(input.urlTarget, input.urlPath ?? '')
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'URL inválida' }
  }

  const runner = getReconRunner()
  const res = runner.startUrlRun({
    project: input.project,
    toolId: input.toolId,
    url,
    userAgent: context.userAgent,
    rules: { rulesText: context.rulesText, automatedTooling: context.automatedTooling },
    confirmed: input.confirmed,
    timeoutMs: input.timeoutMs,
  })
  if (res.ok) {
    revalidatePath(`/proyectos/${encodeURIComponent(input.project)}`)
    return { ok: true, runId: res.runId, outputDir: res.outputDir, warnings: res.warnings }
  }
  return {
    ok: false,
    error: res.error,
    needsConfirmation: res.needsConfirmation,
    verdictReason: res.verdict?.reason,
  }
}

/** Histórico de runs del proyecto, del más reciente al más viejo. */
export async function listReconRunsAction(project: string): Promise<ReconRunRecord[]> {
  const root = getEnv().REPORTS_ROOT
  const reconRoot = path.join(root, project, 'pentest', 'recon')
  const runs: ReconRunRecord[] = []
  if (!existsSync(reconRoot)) return runs
  for (const toolDir of readdirSync(reconRoot)) {
    const toolPath = path.join(reconRoot, toolDir)
    if (!statSync(toolPath).isDirectory()) continue
    for (const runDir of readdirSync(toolPath)) {
      try {
        const raw = JSON.parse(readFileSync(path.join(toolPath, runDir, 'run.json'), 'utf8')) as ReconRunRecord
        runs.push(raw)
      } catch {
        continue
      }
    }
  }
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/** Cola de salida (los últimos ~8 KB) de un run. */
export async function getReconOutputAction(
  project: string,
  toolId: string,
  dir: string,
): Promise<{ ok: boolean; output?: string; error?: string }> {
  try {
    const abs = resolveSafe(`${project}/pentest/recon/${toolId}/${dir}/output.log`, getEnv().REPORTS_ROOT)
    if (!existsSync(abs)) return { ok: true, output: '' }
    const content = readFileSync(abs, 'utf8')
    return { ok: true, output: content.slice(-8000) }
  } catch (err) {
    if (err instanceof PathEscapeError) return { ok: false, error: err.message }
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

export async function cancelReconAction(runId: string): Promise<{ ok: boolean; error?: string }> {
  const ok = getReconRunner().cancel(runId)
  return ok ? { ok: true } : { ok: false, error: 'Ese run ya no está activo en este servidor' }
}

/** Reclasifica huérfanos y devuelve los que siguen vivos (para la UI). */
export async function recoverOrphansAction(): Promise<{ orphaned: ReconRunRecord[]; interrupted: ReconRunRecord[] }> {
  const runner = getReconRunner()
  const res = runner.recoverOrphans()
  const all = [...res.orphaned, ...res.interrupted]
    .map((id) => runner.getRun(id))
    .filter((r): r is ReconRunRecord => r !== null)
  // los runs de sesiones anteriores no están en el mapa del runner: leer del
  // disco vía listReconRuns de cada proyecto es caro; devolvemos lo mínimo:
  return {
    orphaned: all.filter((r) => r.status === 'orphaned'),
    interrupted: all.filter((r) => r.status === 'interrupted'),
  }
}

/** Mata un huérfano: SOLO con acción humana, tras contrastar starttime. */
export async function killOrphanAction(
  project: string,
  toolId: string,
  dir: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const runJson = resolveSafe(`${project}/pentest/recon/${toolId}/${dir}/run.json`, getEnv().REPORTS_ROOT)
    const ok = getReconRunner().killOrphan(runJson)
    revalidatePath(`/proyectos/${encodeURIComponent(project)}`)
    return ok ? { ok: true } : { ok: false, error: 'El huérfano ya no está vivo o fue reciclado el pid' }
  } catch (err) {
    if (err instanceof PathEscapeError) return { ok: false, error: err.message }
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

/** Hosts vivos del último run de httpx (para ffuf/gobuster). */
export async function getLiveHostsAction(project: string): Promise<{ ok: boolean; hosts?: string[]; error?: string }> {
  try {
    const httpxRoot = resolveSafeAllowMissing(`${project}/pentest/recon/httpx`, getEnv().REPORTS_ROOT)
    if (!existsSync(httpxRoot)) return { ok: true, hosts: [] }
    const dirs = readdirSync(httpxRoot).sort().reverse()
    for (const d of dirs) {
      const log = path.join(httpxRoot, d, 'output.log')
      if (!existsSync(log)) continue
      const hosts = parseHttpxHosts(readFileSync(log, 'utf8'))
      if (hosts.length > 0) return { ok: true, hosts }
    }
    return { ok: true, hosts: [] }
  } catch (err) {
    if (err instanceof PathEscapeError) return { ok: false, error: err.message }
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

// ── Ajustes: rutas por binario con indicador ────────────────────────────

export interface ReconBinStatus {
  toolId: string
  label: string
  binPath: string
  /** existe y es ejecutable */
  ok: boolean
}

export async function getReconBinStatusAction(): Promise<ReconBinStatus[]> {
  return RECON_TOOLS.map((t) => {
    const binPath = resolveBinPath(t.id)
    let ok = false
    try {
      accessSync(binPath, constants.X_OK)
      ok = true
    } catch {
      ok = false
    }
    return { toolId: t.id, label: t.label, binPath, ok }
  })
}

export async function saveReconSettingsAction(input: {
  binPaths: Record<string, string>
  wordlist?: string
  timeoutMinutes?: number
}): Promise<{ ok: boolean; error?: string }> {
  try {
    for (const [toolId] of Object.entries(input.binPaths)) {
      if (!getTool(toolId)) return { ok: false, error: `Herramienta desconocida: ${toolId}` }
    }
    const settings: ReconSettings = { binPaths: input.binPaths as ReconSettings['binPaths'] }
    if (input.wordlist !== undefined) settings.wordlist = input.wordlist
    if (input.timeoutMinutes !== undefined) settings.timeoutMinutes = input.timeoutMinutes
    saveReconSettings(settings)
    revalidatePath('/ajustes')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

export async function getReconSettingsAction(): Promise<ReconSettings> {
  return loadReconSettings()
}
