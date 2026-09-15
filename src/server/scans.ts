import { existsSync } from 'node:fs'
import { getEnv } from '@/lib/env'
import { listProjects } from '@/core/fs/tree'
import { loadOrcaSettings } from '@/core/orca/settings'
import {
  combined,
  defaultExec,
  type ExecResult,
} from '@/core/orca/runner'
import {
  deriveTerminalStatus,
  fmtLastActivity,
  parseOrcaTerminalList,
  toEpochMs,
  type OrcaTerminal,
  type OrcaTerminalStatus,
} from '@/core/orca/orca'
import { readLaunches, type LaunchRecord } from './launches'

/**
 * Pestaña "Escaneos" (global y por proyecto): una FILA POR AGENTE.
 *
 * FUENTE (persistente): launches.json de cada proyecto — cada lanzamiento
 * tiene VARIOS agentes (una entrada por agente con label, provider, prompt,
 * worktreeId, handle). Cada entrada es una fila.
 *
 * ESTADO EN VIVO: `orca terminal list --json` consultado AL ABRIR y con el
 * botón "Actualizar" — NUNCA cacheado. "Activa" solo es cierto en el
 * momento de preguntar. Handle ausente → "Sesión cerrada" (no error).
 */

export interface ScanRow {
  project: string
  /** label del agente ("Pi #1"). */
  label: string
  provider: string
  timestamp: number
  worktreeId?: string
  /** handle del terminal (agentTerminalHandle o handle del launch). */
  handle?: string
  /** prompt INICIAL con el que se lanzó (guardado en launches.json). */
  prompt?: string
  /** true si el lanzamiento del agente fue ok. */
  launchOk: boolean
  /** error de lanzamiento cuando !launchOk. */
  launchError?: string
  /** Estado derivado AHORA (efímero). */
  status: OrcaTerminalStatus
  statusLabel: string
  lastActivityAgoMs: number | null
  lastActivityLabel: string
  /** title del terminal como pista extra (p. ej. "Pi ready"). */
  title?: string
}

export interface ScansView {
  rows: ScanRow[]
  /** true si Orca no estaba alcanzable al consultar el estado en vivo. */
  liveError?: string
}

/** Ejecuta `orca ... --json` una vez (para tests: exec inyectable). */
export type ExecScan = (bin: string, args: string[]) => Promise<ExecResult>

export interface BuildScansOptions {
  exec?: ExecScan
  nowMs?: number
  /** Si se pasa, SOLO los lanzamientos de ese proyecto (vista por proyecto). */
  project?: string
}

/**
 * Agrega el estado en vivo. Una fila por agente (entrada de launches.json).
 * `project` filtra a un solo proyecto; si no, agrega todos (vista global).
 */
export async function buildScansView(
  root: string = getEnv().REPORTS_ROOT,
  opts: BuildScansOptions = {},
): Promise<ScansView> {
  const exec = opts.exec ?? defaultExec
  const now = opts.nowMs ?? Date.now()
  const { orcaBin } = loadOrcaSettings()

  const projects = opts.project ? (includesProject(root, opts.project) ? [opts.project] : []) : listProjects(root)

  // Una fila por AGENTE de cada proyecto (pentest/launches.json)
  const rows: ScanRow[] = []
  for (const project of projects) {
    const launches = readLaunches(project, root)
    for (const l of launches) {
      const handle = terminalHandleFor(l)
      const label = l.label ?? l.provider
      rows.push({
        project,
        label,
        provider: l.provider,
        timestamp: l.timestamp,
        worktreeId: l.worktreeId,
        handle,
        prompt: l.prompt,
        launchOk: l.ok,
        launchError: l.error,
        status: l.ok ? 'unknown' : 'closed',
        statusLabel: l.ok ? 'Consulta en vivo…' : 'Error de lanzamiento',
        lastActivityAgoMs: null,
        lastActivityLabel: '—',
      })
    }
  }
  if (rows.length === 0) return { rows }

  // Estado EN VIVO: una consulta al abrir/actualizar (nunca cacheado)
  let terminals: OrcaTerminal[] = []
  try {
    const res = await exec(orcaBin, ['terminal', 'list', '--json'])
    terminals = parseOrcaTerminalList(combined(res)).terminals
  } catch {
    // si Orca no responde, los ok quedan 'unknown'
  }

  const byHandle = new Map(terminals.map((t) => [t.handle, t]))
  for (const row of rows) {
    if (!row.launchOk) continue // falló al lanzar: no hay terminal que derivar
    const terminal = row.handle ? byHandle.get(row.handle) : undefined
    const info = deriveTerminalStatus(terminal, now)
    row.status = info.status
    row.statusLabel = info.label
    row.lastActivityAgoMs = info.lastActivityAgoMs
    row.lastActivityLabel = fmtLastActivity(info.lastActivityAgoMs)
    row.title = terminal?.title
  }

  return { rows }
}

function includesProject(root: string, project: string): boolean {
  const { join } = require('node:path') as typeof import('node:path')
  const { existsSync } = require('node:fs') as typeof import('node:fs')
  return existsSync(join(root, project))
}

/** Handle de terminal para un launch: agentTerminalHandle > handle. */
export function terminalHandleFor(l: LaunchRecord): string | undefined {
  return l.agentTerminalHandle ?? l.handle
}

export { toEpochMs }