import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from '@/lib/env'
import { writeAtomic } from '@/core/fs/atomic'
import { resolveSafeAllowMissing } from '@/core/fs/paths'

/**
 * Historial de lanzamientos: `<root>/<project>/pentest/launches.json`
 * (append a un array). Ya cae dentro de pentest/ (gitignored).
 */

export interface LaunchRecord {
  timestamp: number
  provider: string
  /** Assets del scope seleccionados (paso 1 del asistente). */
  scopeSeleccionado: string[]
  mode: string
  worktreeId?: string
  handle?: string
  agentTerminalHandle?: string
  ok: boolean
  error?: string
}

export interface LaunchesFile {
  launches: LaunchRecord[]
}

/** Ruta segura (dentro del root) del launches.json del proyecto. */
export function launchesPath(
  project: string,
  root: string = getEnv().REPORTS_ROOT,
): string {
  return resolveSafeAllowMissing(path.join(project, 'pentest', 'launches.json'), root)
}

/** Lee el historial de un proyecto; [] si no existe. */
export function readLaunches(
  project: string,
  root: string = getEnv().REPORTS_ROOT,
): LaunchRecord[] {
  try {
    const abs = launchesPath(project, root)
    if (!existsSync(abs)) return []
    const raw = JSON.parse(readFileSync(abs, 'utf8')) as LaunchesFile | LaunchRecord[]
    if (Array.isArray(raw)) return raw
    if (Array.isArray(raw?.launches)) return raw.launches
    return []
  } catch {
    return []
  }
}

/** Añade un registro al final del array (append, atómico). */
export function appendLaunch(
  project: string,
  record: LaunchRecord,
  root: string = getEnv().REPORTS_ROOT,
): void {
  const dir = resolveSafeAllowMissing(path.join(project, 'pentest'), root)
  mkdirSync(dir, { recursive: true })
  const existing = readLaunches(project, root)
  const next = [...existing, record]
  writeAtomic(path.join(project, 'pentest', 'launches.json'), JSON.stringify({ launches: next }, null, 2), { root })
}