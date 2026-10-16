/**
 * Config de auditoría completa por proyecto (Tarea 12a). Base del epic 12:
 * lo que el operador define UNA VEZ — plantilla de misión/prompt, agente,
 * presupuesto y si el flujo corre recon o lo salta.
 *
 * - Persistida en `.settings/audit.json` (opt-in explícito; SIN secretos).
 * - Normalización tolerante estilo schedule/settings: valores raros →
 *   defaults; presupuesto CLAMPADO a límites operativos.
 * - La plantilla de misión por defecto es la de 7e (DEFAULT_MISSION_TEMPLATE
 *   en core/recon/mission.ts) — este módulo NO la importa: 12b resuelve
 *   `promptTemplate ?? DEFAULT_MISSION_TEMPLATE` al ensamblar.
 *
 * Filosofía del epic (decisión del operador): el clic inicial ES la
 * autorización. La config es OPERATIVA (presupuesto/agentes), nunca de
 * permisos.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { settingsDir } from '../llm/settings'

export interface AuditBudget {
  /** Tope de tokens del LLM del flujo (0/undefined = sin tope explícito aquí). */
  tokens: number
  /** Tope de tiempo TOTAL de la auditoría en ms. */
  timeMs: number
  /** Nº máximo de agentes a lanzar. */
  maxAgents: number
}

export interface ProjectAuditConfig {
  /** Opt-in explícito: sin enabled, el orquestador rechaza lanzar. */
  enabled: boolean
  /** true = recon pipeline completo antes de la misión; false = saltarlo. */
  runRecon: boolean
  /** Agente Orca (id: pi, claude, hermes, kimi, zcode, deepseek). */
  agent: string
  /** Modelo concreto si el agente lo soporta (opcional). */
  model?: string
  /** Plantilla de misión del proyecto; undefined = la de 7e. */
  promptTemplate?: string
  budget: AuditBudget
}

export interface AuditConfigFile {
  projects: Record<string, ProjectAuditConfig>
}

/** Límites operativos del presupuesto (clamp duro). */
export const AUDIT_LIMITS = {
  tokens: { min: 1_000, max: 2_000_000, default: 200_000 },
  timeMs: { min: 60_000, max: 24 * 60 * 60_000, default: 2 * 60 * 60_000 },
  maxAgents: { min: 1, max: 10, default: 1 },
} as const

function clampInt(value: unknown, limits: { min: number; max: number; default: number }): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : NaN
  if (!Number.isFinite(n)) return limits.default
  return Math.min(limits.max, Math.max(limits.min, n))
}

/** Normaliza UN proyecto: defaults sensatos; raro → default; clamp presupuesto. */
export function normalizeProjectAudit(raw: unknown): ProjectAuditConfig {
  const v = ((raw ?? {}) as {
    enabled?: unknown
    runRecon?: unknown
    agent?: unknown
    model?: unknown
    promptTemplate?: unknown
    budget?: unknown
  }) ?? {}

  const agent = typeof v.agent === 'string' && v.agent.trim() !== '' ? v.agent.trim() : 'pi'
  const model = typeof v.model === 'string' && v.model.trim() !== '' ? v.model.trim() : undefined
  const promptTemplate =
    typeof v.promptTemplate === 'string' && v.promptTemplate.trim() !== ''
      ? v.promptTemplate
      : undefined
  const budgetRaw = (v.budget ?? {}) as Record<string, unknown>

  return {
    enabled: v.enabled === true,
    runRecon: v.runRecon !== false, // por defecto SÍ corre recon (auditoría COMPLETA)
    agent,
    ...(model !== undefined ? { model } : {}),
    ...(promptTemplate !== undefined ? { promptTemplate } : {}),
    budget: {
      tokens: clampInt(budgetRaw.tokens, AUDIT_LIMITS.tokens),
      timeMs: clampInt(budgetRaw.timeMs, AUDIT_LIMITS.timeMs),
      maxAgents: clampInt(budgetRaw.maxAgents, AUDIT_LIMITS.maxAgents),
    },
  }
}

/** Config tolerante desde JSON de disco. */
export function normalizeAuditConfig(raw: unknown): AuditConfigFile {
  const projects: Record<string, ProjectAuditConfig> = {}
  if (raw !== null && typeof raw === 'object' && 'projects' in raw) {
    const rawProjects = (raw as { projects?: Record<string, unknown> }).projects
    if (rawProjects !== null && typeof rawProjects === 'object') {
      for (const [project, value] of Object.entries(rawProjects)) {
        if (project === '' || project.includes('/') || project.startsWith('.')) continue
        projects[project] = normalizeProjectAudit(value)
      }
    }
  }
  return { projects }
}

/** Proyecto SIN config → deshabilitado por defecto (opt-in explícito). */
export function defaultProjectAudit(): ProjectAuditConfig {
  return normalizeProjectAudit({})
}

// ── Persistencia: .settings/audit.json (opt-in; SIN secretos) ───────────

function auditFile(): string {
  return path.join(settingsDir(), 'audit.json')
}

/** Lee la config de disco (tolerante); sin fichero → deshabilitado total. */
export function loadAuditConfig(): AuditConfigFile {
  try {
    if (existsSync(auditFile())) {
      return normalizeAuditConfig(JSON.parse(readFileSync(auditFile(), 'utf8')))
    }
  } catch {
    /* corrupto → deshabilitado (opt-in: sin config no corre nada) */
  }
  return normalizeAuditConfig({ projects: {} })
}

/** Guarda la config NORMALIZADA (round-trip estable). */
export function saveAuditConfig(config: AuditConfigFile): void {
  const clean = normalizeAuditConfig(config)
  mkdirSync(settingsDir(), { recursive: true })
  writeFileSync(auditFile(), JSON.stringify(clean, null, 2) + '\n', { mode: 0o600 })
}

/** Config del proyecto (o deshabilitado por defecto — opt-in explícito). */
export function getProjectAudit(project: string): ProjectAuditConfig {
  return loadAuditConfig().projects[project] ?? defaultProjectAudit()
}

/** Parchea la config del proyecto (merge + clamp) y persiste. */
export function setProjectAudit(
  project: string,
  patch: Partial<Omit<ProjectAuditConfig, 'budget'>> & { budget?: Partial<AuditBudget> },
): ProjectAuditConfig {
  const config = loadAuditConfig()
  const current = config.projects[project] ?? defaultProjectAudit()
  const next = normalizeProjectAudit({
    ...current,
    ...patch,
    model: patch.model === undefined ? current.model : patch.model,
    promptTemplate:
      patch.promptTemplate === undefined ? current.promptTemplate : patch.promptTemplate,
    budget: { ...current.budget, ...(patch.budget ?? {}) },
  })
  config.projects[project] = next
  saveAuditConfig(config)
  return next
}
