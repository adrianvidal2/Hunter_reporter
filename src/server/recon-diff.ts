import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from '@/lib/env'
import { resolveSafeAllowMissing } from '@/core/fs/paths'
import { getTool } from '@/core/recon/tools'
import { diffReconRuns, extractReconItems, isDiffableTool, type ReconDiff } from '@/core/recon/diff'

/**
 * Lector de runs de recon del árbol y diff de los dos más recientes.
 *
 * Lee `<proyecto>/pentest/recon/<tool>/<timestamp>/output.log` de cada run,
 * extrae su inventario de assets (hosts/URLs) y compara los dos últimos para
 * resaltar lo NUEVO. El orden de los directorios es cronológico (el nombre
 * es un timestamp → orden lexicográfico = cronológico, mismo criterio que
 * el runner y el historial). La lógica de comparación vive en `core/recon/diff.ts`.
 */

export interface ReconRunRef {
  /** Nombre del directorio del run (timestamp). */
  dirName: string
  /** Ruta relativa a REPORTS_ROOT con '/'. */
  relPath: string
  /** Nº de items (hosts/URLs) encontrados en ese run. */
  itemCount: number
}

export interface ReconDiffResult {
  ok: boolean
  /** Motivo cuando ok=false (sin runs suficientes, herramienta no diffeable…). */
  reason?: string
  project: string
  toolId: string
  previous?: ReconRunRef
  current?: ReconRunRef
  diff?: ReconDiff
}

interface LoadedRun {
  dirName: string
  relPath: string
  items: string[]
}

/** Compara los dos runs más recientes de una herramienta en un proyecto. */
export function diffLatestReconRuns(
  project: string,
  toolId: string,
  root: string = getEnv().REPORTS_ROOT,
): ReconDiffResult {
  const base = { ok: false, project, toolId } as const
  const tool = getTool(toolId)
  if (!tool) return { ...base, reason: `Herramienta fuera de la lista blanca: ${toolId}` }
  if (!isDiffableTool(toolId)) {
    return { ...base, reason: `${tool.label} no produce un inventario de hosts/URLs comparable` }
  }

  const toolDirRel = path.join(project, 'pentest', 'recon', toolId)
  let toolDirAbs: string
  try {
    toolDirAbs = resolveSafeAllowMissing(toolDirRel, root)
  } catch {
    return { ...base, reason: 'Ruta de runs inválida' }
  }
  if (!existsSync(toolDirAbs)) {
    return { ...base, reason: `Sin runs de ${tool.label} en este proyecto` }
  }

  const runs = readRuns(toolDirAbs, toolDirRel, toolId)
  if (runs.length < 2) {
    return { ...base, reason: 'Hacen falta al menos dos runs para comparar' }
  }

  const previous = runs[runs.length - 2]!
  const current = runs[runs.length - 1]!
  return {
    ok: true,
    project,
    toolId,
    previous: ref(previous),
    current: ref(current),
    diff: diffReconRuns(previous.items, current.items),
  }
}

/** Runs con output.log, en orden cronológico, con su inventario ya extraído. */
function readRuns(toolDirAbs: string, toolDirRel: string, toolId: string): LoadedRun[] {
  let dirNames: string[]
  try {
    dirNames = readdirSync(toolDirAbs, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }

  const runs: LoadedRun[] = []
  for (const dirName of dirNames) {
    const logAbs = path.join(toolDirAbs, dirName, 'output.log')
    if (!existsSync(logAbs)) continue
    let output: string
    try {
      output = readFileSync(logAbs, 'utf8')
    } catch {
      continue
    }
    const items = extractReconItems(toolId, output)
    if (items === null) continue // defensa: isDiffableTool ya lo garantizó
    runs.push({
      dirName,
      relPath: `${toolDirRel.split(path.sep).join('/')}/${dirName}`,
      items,
    })
  }
  return runs
}

function ref(run: LoadedRun): ReconRunRef {
  return { dirName: run.dirName, relPath: run.relPath, itemCount: run.items.length }
}
