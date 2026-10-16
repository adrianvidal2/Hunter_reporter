import { planPipeline } from '@/core/recon/pipeline'
import { assessAutomatedTooling, type ToolingVerdict } from '@/core/recon/tools'
import { DEFAULT_MISSION_TEMPLATE } from '@/core/recon/mission'
import { renderTemplate } from '@/core/reports/placeholders'
import { getProjectAudit } from '@/core/recon/audit-config'
import { cancelPipeline, getPipeline, startPipeline } from './recon-pipeline'

/**
 * Orquestador de auditoría COMPLETA (Tarea 12b): de un solo disparo humano,
 * encadenar `[recon pipeline (confirmed:true) | saltar]` → misión (7e) →
 * agente (launchOrca).
 *
 * DECISIÓN DEL OPERADOR (mandas tú):
 * - El clic inicial ES la autorización: el orquestador corre DESATENDIDO
 *   tras ese clic y lanza el recon con `confirmed:true`. SIN gate.
 * - El estado de reglas del programa (prohibido/silencio/autorizado) es
 *   INFORMATIVO: se registra en la traza, NUNCA frena.
 *
 * Guardarraíles que SÍ se quedan (operativos, no de permisos):
 * - Opt-in por proyecto (config 12a `enabled`).
 * - Presupuesto: tope de tiempo total y nº de agentes (12a).
 * - Kill switch: cancela el pipeline en curso y NO lanza el agente.
 */

export type AuditPhase = 'recon' | 'mision' | 'agente' | 'done' | 'cancelled' | 'error'

export interface AuditState {
  project: string
  phase: AuditPhase
  runRecon: boolean
  startedAt: string
  finishedAt?: string
  pipelineId?: string
  /** Trazabilidad de reglas: informativa, JAMÁS bloquea. */
  rulesVerdict?: ToolingVerdict
  agent?: { provider: string; label: string; count: number }
  missionPreview?: string
  error?: string
  /** true si el operador pulsó el kill switch. */
  cancelledByUser?: boolean
}

const globalStore = globalThis as typeof globalThis & {
  __reporterAudits?: Map<string, AuditState & InternalBits>
}

interface InternalBits {
  cancelRequested: boolean
  deadline: number
  selectedScopes: string[]
  /** Impl de cancelación inyectada (tests) para el kill switch. */
  cancelPipelineImpl: typeof cancelPipeline
}

export interface StartAuditInput {
  project: string
  /** Override de config: saltar el recon (ir directo a misión→agente). */
  runRecon?: boolean
}

export interface AuditDeps {
  /** Inyectables para tests (defaults: funciones reales del servidor). */
  startPipelineImpl?: typeof startPipeline
  getPipelineImpl?: typeof getPipeline
  cancelPipelineImpl?: typeof cancelPipeline
  buildMissionImpl?: (project: string) => Promise<{ ok: boolean; mission?: string; error?: string }>
  launchOrcaImpl?: (input: {
    project: string
    selectedScopes: string[]
    mode: 'orca'
    agents: { provider: string; prompt: string; label: string }[]
  }) => Promise<{ ok: boolean; error?: string }>
  getContextImpl?: (project: string) => Promise<{
    ok: boolean
    error?: string
    targets?: string[]
    userAgent?: string
    rulesText?: string
    automatedTooling?: number | null
  }>
  sleepImpl?: (ms: number) => Promise<void>
  /** Intervalo de sondeo del pipeline (default 1s; tests: menor). */
  pollMs?: number
  nowMs?: () => number
}

const POLL_MS = 1_000
/** Tope duro de iteraciones de sondeo (anti busy-loop si el sleep es no-op). */
const MAX_POLL_ITERATIONS = 50_000

function store(): Map<string, AuditState & InternalBits> {
  return (globalStore.__reporterAudits ??= new Map())
}

export function getAuditStatus(project: string): AuditState | null {
  const state = store().get(project)
  if (!state) return null
  const { cancelRequested: _c, deadline: _d, selectedScopes: _s, ...snap } = state
  void _c
  void _d
  void _s
  return snap
}

/**
 * Kill switch (operativo): cancela el pipeline en curso y marca cancelled —
 * el orquestador NO lanzará el agente. Lo ya lanzado a Orca se gestiona
 * desde Escaneos.
 */
export function cancelAudit(project: string): boolean {
  const state = store().get(project)
  if (!state || (state.phase !== 'recon' && state.phase !== 'mision' && state.phase !== 'agente')) {
    return false
  }
  state.cancelledByUser = true
  state.phase = 'cancelled'
  state.finishedAt = new Date().toISOString()
  if (state.pipelineId !== undefined) state.cancelPipelineImpl(state.pipelineId)
  return true
}

/**
 * Dispara la auditoría (SOLO botón humano — no hay desatendido por
 * scheduler). Devuelve enseguida; el estado se consulta con getAuditStatus.
 */
export function startAudit(
  input: StartAuditInput,
  deps: AuditDeps = {},
): { ok: true } | { ok: false; error: string } {
  const config = getProjectAudit(input.project)
  if (!config.enabled) {
    return { ok: false, error: 'Auditoría no configurada para este proyecto: actívala en la config (12a)' }
  }
  if (store().has(input.project)) {
    const existing = store().get(input.project)!
    if (['recon', 'mision', 'agente'].includes(existing.phase)) {
      return { ok: false, error: 'Ya hay una auditoría en marcha para este proyecto' }
    }
  }

  const runRecon = input.runRecon ?? config.runRecon
  const nowMs = deps.nowMs ?? Date.now
  const startedAt = new Date(nowMs()).toISOString()
  const deadline = nowMs() + config.budget.timeMs

  const state: AuditState & InternalBits = {
    project: input.project,
    phase: runRecon ? 'recon' : 'mision',
    runRecon,
    startedAt,
    cancelRequested: false,
    deadline,
    selectedScopes: [],
    cancelPipelineImpl: deps.cancelPipelineImpl ?? cancelPipeline,
  }
  store().set(input.project, state)

  void runAudit(state, input, config, deps, nowMs).catch((err: unknown) => {
    state.phase = 'error'
    state.error = err instanceof Error ? err.message : 'Error inesperado del orquestador'
    state.finishedAt = new Date().toISOString()
  })
  return { ok: true }
}

async function runAudit(
  state: AuditState & InternalBits,
  input: StartAuditInput,
  config: ReturnType<typeof getProjectAudit>,
  deps: AuditDeps,
  nowMs: () => number,
): Promise<void> {
  const startPipelineImpl = deps.startPipelineImpl ?? startPipeline
  const getPipelineImpl = deps.getPipelineImpl ?? getPipeline
  const sleep = deps.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const pollMs = Math.max(10, deps.pollMs ?? POLL_MS)
  const buildMissionImpl =
    deps.buildMissionImpl ??
    (async (project: string) => {
      const { buildMissionAction } = await import('@/app/proyectos/[project]/launch')
      return buildMissionAction(project)
    })
  const launchOrcaImpl =
    deps.launchOrcaImpl ??
    (async (orcaInput: { project: string; selectedScopes: string[]; mode: 'orca'; agents: { provider: string; prompt: string; label: string }[] }) => {
      const { launchOrcaAction } = await import('@/app/proyectos/[project]/launch')
      return launchOrcaAction(orcaInput)
    })
  const getContextImpl =
    deps.getContextImpl ??
    (async (project: string) => {
      const { getReconContextAction } = await import('@/app/escaneos/recon-actions')
      return getReconContextAction(project)
    })

  const cancelled = (): boolean => state.cancelledByUser === true

  // 0) Contexto del programa: scope + UA + REGLAS (traza informativa, NO bloquea)
  const context = await getContextImpl(input.project)
  if (!context.ok) {
    state.phase = 'error'
    state.error = context.error ?? 'Sin contexto del programa'
    state.finishedAt = new Date().toISOString()
    return
  }
  state.selectedScopes = context.targets ?? []
  const rulesVerdict = assessAutomatedTooling({
    rulesText: context.rulesText,
    automatedTooling: context.automatedTooling,
  })
  state.rulesVerdict = rulesVerdict // SOLO traza: prohibido NO frena (operador manda)

  // 1) RECON (opcional): plan COMPLETO con confirmed:true — el clic ya autorizó
  if (state.runRecon) {
    const plan = planPipeline(context.targets ?? [])
    const stages = plan.ok ? plan.plan.stages.map((s) => s.toolId) : []
    if (stages.length === 0) {
      state.phase = 'mision' // sin plan: saltar directo a misión (sin inventar)
    } else {
      const started = startPipelineImpl({
        project: input.project,
        scope: context.targets ?? [],
        userAgent: context.userAgent,
        rules: { rulesText: context.rulesText, automatedTooling: context.automatedTooling },
        stages,
        confirmed: true, // el clic humano ya autorizó: SIN gate
      })
      if (!started.ok) {
        state.phase = 'error'
        state.error = started.error
        state.finishedAt = new Date().toISOString()
        return
      }
      state.pipelineId = started.pipelineId

      // esperar fin del pipeline (presupuesto de tiempo + kill switch)
      let iterations = 0
      for (;;) {
        if (cancelled()) {
          state.finishedAt = new Date().toISOString()
          return
        }
        const snap = getPipelineImpl(state.pipelineId)
        if (!snap) {
          state.phase = 'error'
          state.error = 'El pipeline desapareció del registro'
          state.finishedAt = new Date().toISOString()
          return
        }
        if (snap.status !== 'running') {
          if (snap.status !== 'done') {
            state.phase = 'error'
            state.error = snap.reason ?? `pipeline en estado ${snap.status}`
            state.finishedAt = new Date().toISOString()
            return
          }
          break
        }
        if (nowMs() > state.deadline) {
          state.cancelPipelineImpl(state.pipelineId)
          state.phase = 'error'
          state.error = 'Presupuesto de tiempo agotado durante el recon'
          state.finishedAt = new Date().toISOString()
          return
        }
        iterations++
        if (iterations > MAX_POLL_ITERATIONS) {
          state.cancelPipelineImpl(state.pipelineId)
          state.phase = 'error'
          state.error = 'Sondeo del pipeline excedido (bucle de espera)'
          state.finishedAt = new Date().toISOString()
          return
        }
        await sleep(pollMs)
      }
    }
  }
  if (cancelled()) {
    state.finishedAt = new Date().toISOString()
    return
  }

  // 2) MISIÓN (7e): plantilla de 12a + artifacts del último harvest
  state.phase = 'mision'
  if (cancelled()) {
    state.finishedAt = new Date().toISOString()
    return
  }
  const missionRes = await buildMissionImpl(input.project)
  let mission: string
  if (missionRes.ok && missionRes.mission) {
    mission = missionRes.mission
  } else {
    // sin harvest: plantilla de 12a (o la de 7e) con lo que hay — sin inventar datos
    mission = renderTemplate(config.promptTemplate ?? DEFAULT_MISSION_TEMPLATE, {
      proyecto: input.project,
    })
  }
  state.missionPreview = mission.slice(0, 200)
  if (cancelled()) {
    state.finishedAt = new Date().toISOString()
    return
  }

  // 3) AGENTE: 1..maxAgents con el agente/modelo de 12a
  state.phase = 'agente'
  const shortName = config.agent.split(/[\s-]/)[0] ?? config.agent
  const agents = Array.from({ length: config.budget.maxAgents }, (_, i) => ({
    provider: config.agent,
    prompt: mission,
    label: `${shortName.charAt(0).toUpperCase()}${shortName.slice(1)} #${i + 1}`,
  }))
  state.agent = { provider: config.agent, label: agents[0]!.label, count: agents.length }

  const launch = await launchOrcaImpl({
    project: input.project,
    selectedScopes: state.selectedScopes,
    mode: 'orca',
    agents,
  })
  if (!launch.ok) {
    state.phase = 'error'
    state.error = launch.error ?? 'No se pudo lanzar el agente'
    state.finishedAt = new Date().toISOString()
    return
  }

  state.phase = 'done'
  state.finishedAt = new Date().toISOString()
}

