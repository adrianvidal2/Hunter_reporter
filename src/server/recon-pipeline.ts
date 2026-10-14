import { existsSync, readFileSync } from 'node:fs'
import { getEnv } from '@/lib/env'
import { resolveSafe } from '@/core/fs/paths'
import { composeUrl } from '@/core/recon/flows'
import {
  extractPipelineItems,
  intersectWithScope,
  planPipeline,
  type PipelineStage,
} from '@/core/recon/pipeline'
import {
  assessAutomatedTooling,
  GF_PATTERNS,
  getTool,
  needsGate,
  type ProgramRulesInput,
} from '@/core/recon/tools'
import { getReconRunner, type ReconRunRecord, type ReconRunner } from './recon-runner'

/**
 * Orquestador del pipeline de recon (Tarea 2): recorre el plan APROBADO por
 * el humano etapa a etapa, llenando los targets de cada etapa con la salida
 * interseccionada de la anterior. El runner (lista blanca + recetas) sigue
 * lanzando TODO; aquí no se spawnea nada ni se construyen comandos.
 *
 * Seguridad:
 * - Los targets de la etapa N salen SIEMPRE de la salida de la N-1 (leída
 *   del disco del servidor) o del scope del programa; NADA viene del
 *   cliente salvo qué etapas lanzar y la confirmación del gate.
 * - La intersección con el scope es por HOST (exacto o subdominio de un
 *   wildcard DECLARADO): lo enumerado bajo `*.x.com` pasa; `fuera.com`
 *   queda fuera. El scope efectivo que recibe el runner es
 *   `[scope, ...targets]` (calculado server-side); el runner vuelve a
 *   intersecar (defensa en profundidad).
 * - El gate de reglas se comprueba AQUÍ antes de cada etapa
 *   active/exploitation (y el runner lo re-comprueba al lanzar).
 * - Una etapa sin resultados, fallida, en timeout o cancelada PARA el
 *   pipeline: nunca se arrastra vacío ni a ciegas a la siguiente.
 */

export interface StartPipelineInput {
  project: string
  /** Scope in-scope ACTUAL del programa.json (lo trae la server action). */
  scope: string[]
  userAgent?: string
  rules?: ProgramRulesInput
  /** toolIds en orden: subconjunto del plan calculado en el servidor. */
  stages: string[]
  /** Confirmación del gate para las etapas active/exploitation. */
  confirmed?: boolean
  timeoutMs?: number
}

export type StartPipelineResult =
  | { ok: true; pipelineId: string }
  | { ok: false; error: string }

export interface PipelineStageOutcome {
  toolId: string
  status: 'done' | 'error' | 'empty' | 'gate' | 'cancelled' | 'skipped'
  runIds: string[]
  /** Items (dentro del scope) que la etapa deja a la siguiente. */
  itemCount?: number
  error?: string
}

export interface PipelineSnapshot {
  id: string
  project: string
  status: 'running' | 'done' | 'stopped' | 'cancelled'
  startedAt: string
  finishedAt?: string
  stages: PipelineStageOutcome[]
  /** Motivo cuando el pipeline se paró antes de tiempo. */
  reason?: string
  needsConfirmation?: boolean
  /** toolId de la etapa que pidió pasar el gate. */
  stoppedBefore?: string
}

interface PipelineState extends PipelineSnapshot {
  cancelled: boolean
  currentRunIds: string[]
  runner: ReconRunner
}

export interface PipelineDeps {
  /** Inyectable para tests. */
  runner?: ReconRunner
  root?: string
}

/** Registro de pipelines vivos (globalThis, mismo patrón que el runner). */
function registry(): Map<string, PipelineState> {
  const store = (globalThis.__reporterPipelineRegistry ??= new Map<string, PipelineState>())
  return store
}

declare global {
  var __reporterPipelineRegistry: Map<string, PipelineState> | undefined
}

/**
 * Valida el plan y las etapas pedidas contra el plan del SERVIDOR y lanza
 * la ejecución en segundo plano. Devuelve enseguida: el estado se consulta
 * con getPipeline() y se cancela con cancelPipeline().
 */
export function startPipeline(input: StartPipelineInput, deps: PipelineDeps = {}): StartPipelineResult {
  const planRes = planPipeline(input.scope)
  if (!planRes.ok) return { ok: false, error: planRes.reason }
  const plan = planRes.plan

  // Subconjunto del plan, SIN duplicados y en el orden del plan: el cliente
  // elige qué etapas, jamás qué herramientas ni qué targets.
  const chosen: PipelineStage[] = []
  let cursor = 0
  for (const toolId of input.stages) {
    const idx = plan.stages.findIndex((s, i) => i >= cursor && s.toolId === toolId)
    if (idx < 0) {
      const available = plan.stages.map((s) => s.toolId).join(', ')
      return { ok: false, error: `Etapa no disponible, repetida o fuera de orden: ${toolId} (plan: ${available})` }
    }
    chosen.push(plan.stages[idx]!)
    cursor = idx + 1
  }
  if (chosen.length === 0) return { ok: false, error: 'No hay etapas que lanzar: el plan está vacío' }

  const id = `pipeline-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`
  const state: PipelineState = {
    id,
    project: input.project,
    status: 'running',
    startedAt: new Date().toISOString(),
    stages: [],
    cancelled: false,
    currentRunIds: [],
    runner: deps.runner ?? getReconRunner(),
  }
  registry().set(id, state)

  const root = deps.root ?? getEnv().REPORTS_ROOT
  void executePipeline(state, input, chosen, root).catch((err: unknown) => {
    state.status = 'stopped'
    state.reason = err instanceof Error ? err.message : 'Error inesperado del pipeline'
    state.finishedAt = new Date().toISOString()
  })
  return { ok: true, pipelineId: id }
}

/** Estado serializable de un pipeline (null si no existe o ya se recogió). */
export function getPipeline(id: string): PipelineSnapshot | null {
  const state = registry().get(id)
  if (!state) return null
  return {
    id: state.id,
    project: state.project,
    status: state.status,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    stages: state.stages,
    reason: state.reason,
    needsConfirmation: state.needsConfirmation,
    stoppedBefore: state.stoppedBefore,
  }
}

/** Cancela: marca el flag y manda SIGTERM al run en curso; las etapas siguientes no arrancan. */
export function cancelPipeline(id: string): boolean {
  const state = registry().get(id)
  if (!state || state.status !== 'running') return false
  state.cancelled = true
  for (const runId of state.currentRunIds) state.runner.cancel(runId)
  return true
}

// ── Ejecución ───────────────────────────────────────────────────────────

async function executePipeline(
  state: PipelineState,
  input: StartPipelineInput,
  stages: PipelineStage[],
  root: string,
): Promise<void> {
  const verdict = assessAutomatedTooling(input.rules ?? {})
  let prev: string[] = [] // items (en scope) que deja la etapa anterior

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]!
    const label = getTool(stage.toolId)?.label ?? stage.toolId

    if (state.cancelled) {
      skipRest(state, stages, i)
      break
    }

    // 1) Targets de la etapa según su fuente. Los FIJOS salen del plan del
    // servidor (derivado del programa.json: bases de wildcards, hosts o URLs
    // exactas) y no necesitan el filtro por host; lo EXTRAÍDO de la etapa
    // anterior SIEMPRE se intersecciona con el scope (por host).
    const fixed = stage.source === 'prev' ? [] : stage.targets
    const extracted = stage.source === 'scope' ? [] : prev
    const targets: string[] = []
    for (const t of [...intersectWithScope(extracted, input.scope), ...fixed]) {
      if (!targets.includes(t)) targets.push(t)
    }
    if (targets.length === 0) {
      state.stages.push({
        toolId: stage.toolId,
        status: 'empty',
        runIds: [],
        error: `${label}: ningún target dentro del scope para esta etapa`,
      })
      state.reason = `Pipeline parado: ${label} no tiene targets dentro del scope`
      state.status = 'stopped'
      skipRest(state, stages, i + 1)
      break
    }

    // 2) Gate de reglas ANTES de la etapa (activo/explotación sin autorización explícita).
    if (needsGate(stage.toolId, verdict) && !input.confirmed) {
      state.stages.push({ toolId: stage.toolId, status: 'gate', runIds: [], error: verdict.reason })
      state.needsConfirmation = true
      state.stoppedBefore = stage.toolId
      state.reason = `Pipeline parado antes de ${label}: ${verdict.reason}`
      state.status = 'stopped'
      skipRest(state, stages, i + 1)
      break
    }

    // 3) Lanzar la etapa con el runner (lista blanca + recetas + su propio gate).
    const launch = await launchStage(state, input, stage, targets)
    if (launch.cancelledHit) {
      state.stages.push({ toolId: stage.toolId, status: 'cancelled', runIds: launch.runIds })
      state.reason = 'Pipeline cancelado'
      skipRest(state, stages, i + 1)
      break
    }
    if (launch.failed !== null) {
      state.stages.push({ toolId: stage.toolId, status: 'error', runIds: launch.runIds, error: launch.failed })
      state.reason = `Pipeline parado: ${label} falló (${launch.failed})`
      state.status = 'stopped'
      skipRest(state, stages, i + 1)
      break
    }
    const notDone = launch.records.find((run) => run.status !== 'done')
    if (notDone) {
      state.stages.push({
        toolId: stage.toolId,
        status: 'error',
        runIds: launch.runIds,
        error: `Un run de ${label} terminó en estado ${notDone.status}`,
      })
      state.reason = `Pipeline parado: ${label} terminó en estado ${notDone.status}`
      state.status = 'stopped'
      skipRest(state, stages, i + 1)
      break
    }

    // 4) Extraer la salida (aristas hacia la etapa siguiente) y cortar si no hay nada.
    if (stage.extract !== 'none') {
      const items = launch.records.flatMap((run) => extractPipelineItems(stage.toolId, readOutput(root, input.project, run.toolId, run.dirName)) ?? [])
      prev = intersectWithScope(items, input.scope)
      if (prev.length === 0) {
        state.stages.push({
          toolId: stage.toolId,
          status: 'empty',
          runIds: launch.runIds,
          itemCount: 0,
          error: `${label} terminó sin resultados dentro del scope`,
        })
        state.reason = `Pipeline parado: ${label} no produjo resultados dentro del scope`
        state.status = 'stopped'
        skipRest(state, stages, i + 1)
        break
      }
      state.stages.push({ toolId: stage.toolId, status: 'done', runIds: launch.runIds, itemCount: prev.length })
    } else {
      state.stages.push({ toolId: stage.toolId, status: 'done', runIds: launch.runIds })
    }
  }

  if (state.status === 'running') state.status = state.cancelled ? 'cancelled' : 'done'
  state.finishedAt = new Date().toISOString()
}

/** Lanza los comandos de una etapa (1 en el caso normal; 1 por URL en la vía sqlmap/dalfox; 1 por patrón en gf) y espera cada run. */
async function launchStage(
  state: PipelineState,
  input: StartPipelineInput,
  stage: PipelineStage,
  targets: string[],
): Promise<{ runIds: string[]; records: ReconRunRecord[]; failed: string | null; cancelledHit: boolean }> {
  const runIds: string[] = []
  const records: ReconRunRecord[] = []
  const tool = getTool(stage.toolId)

  type Job = { kind: 'scope'; toolId: string } | { kind: 'url'; toolId: string; url: string } | { kind: 'gf'; toolId: string; pattern: string }
  const jobs: Job[] =
    tool?.scopeMode === 'url'
      ? targets.map((url) => ({ kind: 'url', toolId: stage.toolId, url }) as Job)
      : stage.toolId === 'gf'
        ? GF_PATTERNS.map((pattern) => ({ kind: 'gf', toolId: stage.toolId, pattern }) as Job)
        : [{ kind: 'scope', toolId: stage.toolId }]

  for (const job of jobs) {
    if (state.cancelled) return { runIds, records, failed: null, cancelledHit: true }
    let res: { ok: true; runId: string } | { ok: false; error: string; needsConfirmation?: boolean }
    if (job.kind === 'url') {
      res = state.runner.startUrlRun({
        project: input.project,
        toolId: job.toolId,
        url: composeUrl(job.url, ''),
        userAgent: input.userAgent,
        rules: input.rules,
        confirmed: input.confirmed,
        timeoutMs: input.timeoutMs,
      })
    } else if (job.kind === 'gf') {
      res = state.runner.startGfRun({ project: input.project, pattern: job.pattern, urls: targets, timeoutMs: input.timeoutMs })
    } else {
      // El scope efectivo es el del programa MÁS lo ya demostrado en scope
      // (enumerado bajo wildcard, hosts exactos): todo calculado server-side.
      res = state.runner.start({
        project: input.project,
        toolId: job.toolId,
        targets,
        scope: [...input.scope, ...targets],
        userAgent: input.userAgent,
        rules: input.rules,
        confirmed: input.confirmed,
        timeoutMs: input.timeoutMs,
      })
    }
    if (!res.ok) {
      const why = res.needsConfirmation ? `Sin confirmación para ${job.toolId}` : res.error
      return { runIds, records, failed: why, cancelledHit: false }
    }
    runIds.push(res.runId)
    state.currentRunIds.push(res.runId)
    const record = await waitForRun(state.runner, res.runId, state)
    state.currentRunIds = state.currentRunIds.filter((id) => id !== res.runId)
    if (state.cancelled) return { runIds, records, failed: null, cancelledHit: true }
    if (!record) return { runIds, records, failed: 'El run desapareció del runner', cancelledHit: false }
    records.push(record)
  }
  return { runIds, records, failed: null, cancelledHit: false }
}

/** Espera a que el run salga de 'running' (el runner tiene su propio timeout). */
async function waitForRun(runner: ReconRunner, runId: string, state: PipelineState): Promise<ReconRunRecord | null> {
  for (;;) {
    const run = runner.getRun(runId)
    if (!run) return null
    if (run.status !== 'running') return run
    if (state.cancelled) return run // cancelPipeline ya mandó el cancel al runner
    await new Promise((r) => setTimeout(r, 100))
  }
}

function skipRest(state: PipelineState, stages: PipelineStage[], from: number): void {
  for (let j = from; j < stages.length; j++) {
    state.stages.push({ toolId: stages[j]!.toolId, status: 'skipped', runIds: [] })
  }
}

/** output.log del run, por ruta validada (el contenido es NO confiable: lo parsea el núcleo). */
function readOutput(root: string, project: string, toolId: string, dirName: string): string {
  try {
    const abs = resolveSafe(`${project}/pentest/recon/${toolId}/${dirName}/output.log`, root)
    if (!existsSync(abs)) return ''
    return readFileSync(abs, 'utf8')
  } catch {
    return ''
  }
}
