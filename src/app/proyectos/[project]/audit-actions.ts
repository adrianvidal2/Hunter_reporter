'use server'

import { revalidatePath } from 'next/cache'
import { listProjects } from '@/core/fs/tree'
import { getReconContextAction } from '@/app/escaneos/recon-actions'
import { assessAutomatedTooling } from '@/core/recon/tools'
import { setProjectAudit, getProjectAudit } from '@/core/recon/audit-config'
import {
  cancelAudit,
  getAuditStatus,
  startAudit,
} from '@/server/audit-orchestrator'
import { getEnv } from '@/lib/env'

/**
 * Server Actions de la Auditoría completa (Tarea 12c): envuelven el
 * orquestador 12b. El disparo es HUMANO (botón); el flujo corre
 * desatendido tras ese clic (el clic ES la autorización).
 */

export interface StartAuditActionResult {
  ok: boolean
  error?: string
  /** Fase inicial tras el disparo ('recon' o 'mision'). */
  phase?: string
}

export async function startAuditAction(
  project: string,
  runRecon?: boolean,
): Promise<StartAuditActionResult> {
  try {
    const root = getEnv().REPORTS_ROOT
    if (!listProjects(root).includes(project)) {
      return { ok: false, error: `No existe el proyecto: ${project}` }
    }
    const res = startAudit({ project, runRecon })
    if (!res.ok) return { ok: false, error: res.error }
    revalidatePath(`/proyectos/${encodeURIComponent(project)}`)
    const snap = getAuditStatus(project)
    return { ok: true, phase: snap?.phase }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

export interface AuditStatusActionResult {
  ok: boolean
  error?: string
  status?: {
    phase: string
    runRecon: boolean
    startedAt: string
    finishedAt?: string
    pipelineId?: string
    rulesState?: string
    rulesReason?: string
    agent?: { provider: string; label: string; count: number }
    missionPreview?: string
    error?: string
    cancelledByUser?: boolean
  }
}

export async function getAuditStatusAction(project: string): Promise<AuditStatusActionResult> {
  try {
    const snap = getAuditStatus(project)
    if (!snap) return { ok: true, status: undefined }
    return {
      ok: true,
      status: {
        phase: snap.phase,
        runRecon: snap.runRecon,
        startedAt: snap.startedAt,
        ...(snap.finishedAt !== undefined ? { finishedAt: snap.finishedAt } : {}),
        ...(snap.pipelineId !== undefined ? { pipelineId: snap.pipelineId } : {}),
        ...(snap.rulesVerdict !== undefined
          ? { rulesState: snap.rulesVerdict.state, rulesReason: snap.rulesVerdict.reason }
          : {}),
        ...(snap.agent !== undefined ? { agent: snap.agent } : {}),
        ...(snap.missionPreview !== undefined ? { missionPreview: snap.missionPreview } : {}),
        ...(snap.error !== undefined ? { error: snap.error } : {}),
        ...(snap.cancelledByUser !== undefined ? { cancelledByUser: snap.cancelledByUser } : {}),
      },
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

export async function cancelAuditAction(project: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const killed = cancelAudit(project)
    revalidatePath(`/proyectos/${encodeURIComponent(project)}`)
    return { ok: killed, ...(killed ? {} : { error: 'No hay auditoría activa que cancelar' }) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

/** Aviso INFORMATIVO del estado de reglas del programa (nunca bloquea, 12). */
export async function getAuditRulesInfoAction(
  project: string,
): Promise<{ ok: boolean; error?: string; state?: string; reason?: string }> {
  try {
    const root = getEnv().REPORTS_ROOT
    if (!listProjects(root).includes(project)) {
      return { ok: false, error: `No existe el proyecto: ${project}` }
    }
    const context = await getReconContextAction(project)
    if (!context.ok) return { ok: false, error: context.error ?? 'Sin contexto del programa' }
    const verdict = assessAutomatedTooling({
      rulesText: context.rulesText,
      automatedTooling: context.automatedTooling,
    })
    return { ok: true, state: verdict.state, reason: verdict.reason }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

/** Config de auditoría (12a) para pintar el panel. */
export async function getAuditConfigAction(project: string): Promise<{
  ok: boolean
  error?: string
  config?: ReturnType<typeof getProjectAudit>
}> {
  try {
    return { ok: true, config: getProjectAudit(project) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

/** Guarda la config de auditoría (12a): plantilla/agente/modelo/presupuesto/recon. */
export async function setAuditConfigAction(
  project: string,
  patch: Parameters<typeof setProjectAudit>[1],
): Promise<{ ok: boolean; error?: string }> {
  try {
    const root = getEnv().REPORTS_ROOT
    if (!listProjects(root).includes(project)) {
      return { ok: false, error: `No existe el proyecto: ${project}` }
    }
    setProjectAudit(project, patch)
    revalidatePath(`/proyectos/${encodeURIComponent(project)}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}
