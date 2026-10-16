import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from '@/lib/env'
import { settingsDir } from '@/core/llm/settings'
import {
  DEFAULT_INTERVAL_MINUTES,
  normalizeScheduleConfig,
  passiveLightStages,
  shouldRun,
  type ReconScheduleConfig,
  type ProjectSchedule,
} from '@/core/recon/schedule'
import { getPipeline, startPipeline } from './recon-pipeline'
import { diffLatestReconRuns } from './recon-diff'
import { recordReconNews } from '@/db/recon-news'
import { defaultDbPath } from '../db/db'
import { notifyReconNews } from './watcher-service'

/**
 * Scheduler de recon pasivo (Tarea 9a) + novedades (9b). SINGLETON en
 * globalThis (mismo patrón que recon-runner/watcher-service): con hot-reload
 * no se duplica.
 *
 * REGLA SAGRADA: SOLO etapas passive/light se auto-lanzan (passiveLightStages
 * filtra el plan por risk del catálogo). Lo activo/explotación sigue con clic
 * humano (gate). Opt-in POR PROYECTO: sin `enabled`, un proyecto jamás corre.
 *
 * - Config persistida en `.settings/recon-schedule.json` (opt-in explícito).
 * - Timer único (tick 1 min, inyectable en tests) que lanza ciclos VENCIDOS;
 *   nunca solapa dos ciclos del mismo proyecto.
 * - Tras cada ciclo: diff de las herramientas diffeables contra su run
 *   anterior (server/recon-diff) → novedades a `recon_news` + broadcast SSE.
 */

const DIFFABLE_TOOLS = new Set(['subfinder', 'dnsx', 'httpx', 'katana', 'gospider', 'gau', 'waybackurls', 'waymore'])
const MAX_CYCLE_WAIT_MS = 30 * 60_000

interface SchedulerOptions {
  root?: string
  dbPath?: string
  tickMs?: number
  nowMs?: () => number
  /** Inyectables para tests. */
  getContext?: (project: string) => Promise<{
    ok: boolean
    error?: string
    targets?: string[]
    userAgent?: string
    rulesText?: string
    automatedTooling?: number | null
  }>
  runPipeline?: (project: string, stages: string[]) => Promise<{ ok: boolean; error?: string }>
  onNews?: (project: string, news: { tool: string; items: string[] }[]) => void
}

function scheduleFile(): string {
  return path.join(settingsDir(), 'recon-schedule.json')
}

function loadConfigFile(): ReconScheduleConfig {
  try {
    if (existsSync(scheduleFile())) {
      return normalizeScheduleConfig(JSON.parse(readFileSync(scheduleFile(), 'utf8')))
    }
  } catch {
    /* corrupto → config vacía (opt-in: sin config no corre nada) */
  }
  return normalizeScheduleConfig({ projects: {} })
}

function saveConfigFile(config: ReconScheduleConfig): void {
  mkdirSync(settingsDir(), { recursive: true })
  writeFileSync(scheduleFile(), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
}

export class ReconScheduler {
  private readonly root: string
  private readonly dbPath: string
  private readonly tickMs: number
  private readonly nowMs: () => number
  private readonly getContext: NonNullable<SchedulerOptions['getContext']>
  private readonly runPipeline: NonNullable<SchedulerOptions['runPipeline']>
  private readonly onNews: NonNullable<SchedulerOptions['onNews']>
  private timer: NodeJS.Timeout | null = null
  private readonly runningProjects = new Set<string>()

  constructor(options: SchedulerOptions = {}) {
    this.root = options.root ?? getEnv().REPORTS_ROOT
    this.dbPath = options.dbPath ?? defaultDbPath()
    this.tickMs = options.tickMs ?? 60_000
    this.nowMs = options.nowMs ?? Date.now
    this.getContext =
      options.getContext ??
      (async (project: string) => {
        const { getReconContextAction } = await import('@/app/escaneos/recon-actions')
        return getReconContextAction(project)
      })
    this.runPipeline =
      options.runPipeline ??
      (async (project: string, stages: string[]) => {
        const context = await this.getContext(project)
        if (!context.ok) return { ok: false, error: 'Sin contexto del programa' }
        const res = startPipeline({
          project,
          scope: context.targets ?? [],
          userAgent: context.userAgent,
          rules: { rulesText: context.rulesText, automatedTooling: context.automatedTooling },
          stages,
          confirmed: false, // passive/light: sin gate; NUNCA se marca confirmado
        })
        if (!res.ok) return { ok: false, error: res.error }
        // esperar el pipeline (cap generoso: los stages pasivos son ligeros)
        const deadline = Date.now() + MAX_CYCLE_WAIT_MS
        for (;;) {
          const snap = getPipeline(res.pipelineId)
          if (!snap) return { ok: false, error: 'El pipeline desapareció del registro' }
          if (snap.status !== 'running') {
            return snap.status === 'done' ? { ok: true } : { ok: false, error: snap.reason ?? `estado ${snap.status}` }
          }
          if (Date.now() > deadline) return { ok: false, error: 'Tiempo de ciclo agotado' }
          await new Promise((r) => setTimeout(r, 500))
        }
      })
    this.onNews = options.onNews ?? ((project, news) => {
      const total = news.reduce((n, x) => n + x.items.length, 0)
      notifyReconNews(this.root, { project, total })
    })
  }

  // ── Config (opt-in por proyecto, persistida) ──────────────────────────

  getConfig(): ReconScheduleConfig & { file: string } {
    return { ...loadConfigFile(), file: scheduleFile() }
  }

  getProjectSchedule(project: string): ProjectSchedule {
    const cfg = loadConfigFile()
    return cfg.projects[project] ?? { enabled: false, intervalMinutes: DEFAULT_INTERVAL_MINUTES }
  }

  /** Activa/desactiva y ajusta intervalo (opt-in explícito por proyecto). */
  setProject(project: string, patch: { enabled?: boolean; intervalMinutes?: number }): ProjectSchedule {
    const config = loadConfigFile()
    const current = config.projects[project] ?? { enabled: false, intervalMinutes: DEFAULT_INTERVAL_MINUTES }
    const next: ProjectSchedule = {
      enabled: patch.enabled ?? current.enabled,
      intervalMinutes: Math.max(15, patch.intervalMinutes ?? current.intervalMinutes),
      ...(current.lastCycleAt !== undefined ? { lastCycleAt: current.lastCycleAt } : {}),
    }
    config.projects[project] = next
    saveConfigFile(config)
    return next
  }

  /** Marca el ciclo completado (lo llama el propio scheduler). */
  markCycled(project: string, atIso: string): void {
    const config = loadConfigFile()
    const current = config.projects[project]
    if (!current) return
    config.projects[project] = { ...current, lastCycleAt: atIso }
    saveConfigFile(config)
  }

  // ── Ciclo ─────────────────────────────────────────────────────────────

  /** ¿Toca y puede? (opt-in, intervalo, sin solape). */
  isDue(project: string): boolean {
    const schedule = this.getProjectSchedule(project)
    if (!schedule.enabled) return false
    if (this.runningProjects.has(project)) return false
    return shouldRun(this.nowMs(), schedule.lastCycleAt, schedule.intervalMinutes)
  }

  /**
   * Ejecuta UN ciclo del proyecto: SOLO etapas passive/light del plan, con
   * scope/UA/reglas del programa.json; después diff → novedades + SSE.
   */
  async runCycle(project: string): Promise<{ ok: boolean; stages?: string[]; error?: string }> {
    if (this.runningProjects.has(project)) {
      return { ok: false, error: 'Ya hay un ciclo en marcha para este proyecto' }
    }
    const schedule = this.getProjectSchedule(project)
    if (!schedule.enabled) return { ok: false, error: 'Proyecto sin monitorización activada (opt-in)' }

    // reserva SINCRÓNICA: dos ciclos del mismo proyecto jamás se solapan
    // (la carrera del primer await queda cortada aquí)
    this.runningProjects.add(project)

    try {
      const context = await this.getContext(project)
      if (!context.ok) return { ok: false, error: context.error ?? 'Sin contexto del programa' }

      const stages = passiveLightStages(context.targets ?? [])
      if (stages.length === 0) return { ok: false, error: 'El plan no tiene etapas pasivas/ligeras' }

      const run = await this.runPipeline(project, stages)
      if (!run.ok) {
        // el intento cuenta como ciclo: un pipeline roto no se martilla cada tick
        this.markCycled(project, new Date(this.nowMs()).toISOString())
        return { ok: false, stages, error: run.error }
      }

      // 9b: diff contra el run anterior por herramienta diffeable → novedades
      const news: { tool: string; items: string[] }[] = []
      for (const tool of stages) {
        if (!DIFFABLE_TOOLS.has(tool)) continue
        const diff = diffLatestReconRuns(project, tool, this.root)
        if (!diff.ok || diff.diff === undefined) continue
        if (diff.diff.added.length > 0) {
          const recorded = recordReconNews(project, tool, diff.diff.added, this.dbPath)
          if (recorded.inserted > 0) {
            news.push({ tool, items: diff.diff.added.slice(0, recorded.inserted) })
          }
        }
      }
      if (news.length > 0) this.onNews(project, news)

      this.markCycled(project, new Date(this.nowMs()).toISOString())
      return { ok: true, stages }
    } finally {
      this.runningProjects.delete(project)
    }
  }

  // ── Timer ─────────────────────────────────────────────────────────────

  /** Arranca el tick (idempotente: singleton globalThis + guard interno). */
  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => {
      void this.tick()
    }, this.tickMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Un tick: lanza (sin await, en background) los ciclos vencidos. */
  async tick(): Promise<void> {
    const config = this.getConfig()
    for (const project of Object.keys(config.projects)) {
      if (this.isDue(project)) {
        void this.runCycle(project).catch(() => {
          /* un ciclo que falla no tumba el scheduler */
        })
      }
    }
  }
}

// ── Singleton (globalThis, mismo patrón que recon-runner/watcher) ────────

const globalStore = globalThis as typeof globalThis & {
  __reporterReconScheduler?: Map<string, ReconScheduler>
}

export function getReconScheduler(options: SchedulerOptions = {}): ReconScheduler {
  const root = options.root ?? getEnv().REPORTS_ROOT
  const store = (globalStore.__reporterReconScheduler ??= new Map<string, ReconScheduler>())
  const existing = store.get(root)
  if (existing) return existing
  const scheduler = new ReconScheduler({ ...options, root })
  store.set(root, scheduler)
  scheduler.start()
  return scheduler
}

/** Solo para tests: desregistrar y parar el scheduler de un root. */
export function closeReconScheduler(root: string): void {
  const store = globalStore.__reporterReconScheduler
  const scheduler = store?.get(root)
  if (store && scheduler) {
    scheduler.stop()
    store.delete(root)
  }
}
