import { planPipeline } from './pipeline'
import { getTool } from './tools'

/**
 * Planificación de recon pasivo en schedule (Tarea 9a). Núcleo PURO.
 *
 * REGLA SAGRADA del epic 9: en automático SOLO etapas passive/light. Lo
 * activo/explotación NUNCA se auto-lanza: sigue con clic humano (gate).
 * Esta función es la ÚNICA puerta de entrada a las etapas del scheduler:
 * filtra el plan de `planPipeline` por riesgo, verificado con `getTool`
 * (no se confía en el orden ni en el texto del plan).
 */

export const MIN_INTERVAL_MINUTES = 15
export const DEFAULT_INTERVAL_MINUTES = 360 // 6 h: recon pasivo, ritmo respetuoso
/** Granularidad del tick del scheduler en el servidor (1 min). */
export const TICK_MS = 60_000

export interface ProjectSchedule {
  enabled: boolean
  intervalMinutes: number
  /** ISO de la última vez que el scheduler completó un ciclo (o undefined). */
  lastCycleAt?: string
}

export interface ReconScheduleConfig {
  projects: Record<string, ProjectSchedule>
}

/**
 * Etapas passive/light del plan para un scope: lo ÚNICO que el scheduler
 * puede lanzar. Verificación por `getTool(...).risk` — active/exploitation
 * (nuclei, sqlmap, dalfox, ffuf, gobuster, nmap) jamás pasa el filtro.
 */
export function passiveLightStages(scope: string[]): string[] {
  const plan = planPipeline(scope)
  if (!plan.ok) return []
  return plan.plan.stages
    .filter((s) => {
      const tool = getTool(s.toolId)
      return tool !== null && (tool.risk === 'passive' || tool.risk === 'light')
    })
    .map((s) => s.toolId)
}

/** ¿Toca ciclo? Sin ciclo previo → sí; con él, respetando el intervalo. */
export function shouldRun(nowMs: number, lastCycleAt: string | undefined, intervalMinutes: number): boolean {
  if (lastCycleAt === undefined) return true
  const last = Date.parse(lastCycleAt)
  if (!Number.isFinite(last)) return true
  return nowMs - last >= Math.max(1, intervalMinutes) * 60_000
}

/** Config tolerante desde JSON de disco: lo inválido cae a defaults. */
export function normalizeScheduleConfig(raw: unknown): ReconScheduleConfig {
  const projects: Record<string, ProjectSchedule> = {}
  if (raw !== null && typeof raw === 'object' && raw !== null && 'projects' in raw) {
    const rawProjects = (raw as { projects?: Record<string, unknown> }).projects
    if (rawProjects !== null && typeof rawProjects === 'object') {
      for (const [project, value] of Object.entries(rawProjects)) {
        if (project === '' || project.includes('/') || project.startsWith('.')) continue
        const v = (value ?? {}) as { enabled?: unknown; intervalMinutes?: unknown; lastCycleAt?: unknown }
        const intervalRaw = typeof v.intervalMinutes === 'number' ? Math.floor(v.intervalMinutes) : NaN
        const interval = Number.isFinite(intervalRaw)
          ? Math.max(MIN_INTERVAL_MINUTES, intervalRaw) // clampea al mínimo
          : DEFAULT_INTERVAL_MINUTES
        const lastCycleAt =
          typeof v.lastCycleAt === 'string' && Number.isFinite(Date.parse(v.lastCycleAt))
            ? v.lastCycleAt
            : undefined
        projects[project] = {
          enabled: v.enabled === true,
          intervalMinutes: interval,
          ...(lastCycleAt !== undefined ? { lastCycleAt } : {}),
        }
      }
    }
  }
  return { projects }
}
