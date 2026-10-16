'use server'

import { existsSync } from 'node:fs'
import { revalidatePath } from 'next/cache'
import { resolveSafeAllowMissing } from '@/core/fs/paths'
import { listProjects } from '@/core/fs/tree'
import { listReconNews, clearReconNews } from '@/db/recon-news'
import { closeReconScheduler, getReconScheduler } from '@/server/recon-scheduler'
import { getEnv } from '@/lib/env'

/**
 * Server Actions de la página «Novedades» (Tarea 9c): listar novedades de
 * monitorización y gestionar el opt-in/intervalo del scheduler POR
 * PROYECTO. El scheduler solo lanza etapas passive/light (9a): lo activo
 * sigue con clic humano.
 */

export interface ScheduleProjectStatus {
  project: string
  enabled: boolean
  intervalMinutes: number
  lastCycleAt?: string
  /** ¿El proyecto tiene programa.json (contexto para el recon)? */
  hasProgram: boolean
}

export interface ScheduleStatusResult {
  ok: boolean
  error?: string
  projects?: ScheduleProjectStatus[]
  schedulerFile?: string
}

/** Estado del scheduler por proyecto (opt-in, intervalo, último ciclo). */
export async function getScheduleStatusAction(): Promise<ScheduleStatusResult> {
  try {
    const root = getEnv().REPORTS_ROOT
    const scheduler = getReconScheduler({ root })
    const config = scheduler.getConfig()
    const projects = listProjects(root).map<ScheduleProjectStatus>((project) => {
      const cfg = config.projects[project]
      const hasProgram =
        existsSyncSafe(`${project}/programa.json`, root) ||
        existsSyncSafe(`${project}/pentest/programa.json`, root)
      return {
        project,
        enabled: cfg?.enabled ?? false,
        intervalMinutes: cfg?.intervalMinutes ?? 360,
        ...(cfg?.lastCycleAt !== undefined ? { lastCycleAt: cfg.lastCycleAt } : {}),
        hasProgram,
      }
    })
    return { ok: true, projects, schedulerFile: config.file }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

function existsSyncSafe(rel: string, root: string): boolean {
  try {
    return existsSync(resolveSafeAllowMissing(rel, root))
  } catch {
    return false
  }
}

/** Activa/desactiva la monitorización y ajusta el intervalo (opt-in explícito). */
export async function setScheduleAction(
  project: string,
  patch: { enabled?: boolean; intervalMinutes?: number },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const root = getEnv().REPORTS_ROOT
    if (!listProjects(root).includes(project)) {
      return { ok: false, error: `No existe el proyecto: ${project}` }
    }
    getReconScheduler({ root }).setProject(project, patch)
    revalidatePath('/novedades')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

/** Lanza UN ciclo manual (mismo camino que el automático: solo pasivo/ligero). */
export async function runCycleNowAction(
  project: string,
): Promise<{ ok: boolean; error?: string; stages?: string[] }> {
  try {
    const root = getEnv().REPORTS_ROOT
    if (!listProjects(root).includes(project)) {
      return { ok: false, error: `No existe el proyecto: ${project}` }
    }
    const res = await getReconScheduler({ root }).runCycle(project)
    revalidatePath('/novedades')
    return res.ok ? { ok: true, stages: res.stages } : { ok: false, error: res.error }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

/** Novedades recientes (global o por proyecto). */
export async function listReconNewsAction(
  project?: string,
  limit?: number,
): Promise<
  | { ok: true; news: { project: string; tool: string; item: string; firstSeenAt: string; lastSeenAt: string }[] }
  | { ok: false; error: string }
> {
  try {
    const rows = listReconNews({ project: project || undefined, limit: limit ?? 100 })
    return {
      ok: true,
      news: rows.map((r) => ({
        project: r.project,
        tool: r.tool,
        item: r.item,
        firstSeenAt: r.firstSeenAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
      })),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

/** Vacía las novedades (el índice es reconstruible; no es verdad). */
export async function clearReconNewsAction(project?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    clearReconNews(project || undefined)
    revalidatePath('/novedades')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

/** Cierra el scheduler de este proceso (uso diagnóstico; instrumentation lo re-arranca). */
export async function stopSchedulerAction(): Promise<{ ok: boolean; error?: string }> {
  try {
    closeReconScheduler(getEnv().REPORTS_ROOT)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}
