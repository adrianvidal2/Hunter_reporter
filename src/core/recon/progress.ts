/**
 * Barra de progreso segmentada (Tarea 13). Núcleo PURO: deriva los
 * segmentos (done/current/pending/error) del estado que los paneles ya
 * consultan — sin backend nuevo.
 *
 * - `auditPhaseProgress`: 3 fases de la auditoría completa (12b).
 * - `pipelineProgress`: una etapa por herramienta del pipeline (Tarea 2).
 *
 * Honestidad ante todo: en `cancelled`/`error` la barra marca DÓNDE paró
 * (segmento en error, previos done, siguientes pending) — no finge que
 * terminó. El llamador aporta la última fase en marcha que vio por polling
 * (`lastRunningPhase`); si no la sabe, se asume que paró al principio.
 */

export type SegState = 'done' | 'current' | 'pending' | 'error'

export interface ProgressSegment {
  label: string
  state: SegState
}

/** Fases de la auditoría completa (12b) en orden. */
export const AUDIT_PHASES = ['Recon', 'Misión', 'Agente'] as const

/**
 * Deriva los 3 segmentos de la auditoría desde el `phase` de 12b.
 *
 * - `recon` → [current, pending, pending]
 * - `mision` → [done, current, pending]
 * - `agente` → [done, done, current]
 * - `done` → [done, done, done]
 * - `cancelled`/`error` → paró en `lastRunningPhase` (o al principio si se
 *   desconoce): ese segmento en `error`, previos `done`, siguientes `pending`.
 * - null/vacío/desconocido → todo `pending` (tolerante).
 */
export function auditPhaseProgress(
  phase: string | null | undefined,
  lastRunningPhase?: string | null | undefined,
): ProgressSegment[] {
  const p = typeof phase === 'string' ? phase.trim().toLowerCase() : ''

  // índice (0-based) de la última fase EN MARCHA conocida por polling
  const runningIndex = (() => {
    const r = typeof lastRunningPhase === 'string' ? lastRunningPhase.trim().toLowerCase() : ''
    if (r === 'recon') return 0
    if (r === 'mision') return 1
    if (r === 'agente') return 2
    return -1
  })()

  const stoppedAt = (defaultIndex: number): ProgressSegment[] =>
    AUDIT_PHASES.map((label, i) => ({
      label,
      state: i < defaultIndex ? ('done' as SegState) : i === defaultIndex ? ('error' as SegState) : ('pending' as SegState),
    }))

  switch (p) {
    case 'recon':
      return AUDIT_PHASES.map((label, i) => ({
        label,
        state: i === 0 ? 'current' : 'pending',
      }))
    case 'mision':
      return AUDIT_PHASES.map((label, i) => ({
        label,
        state: i === 0 ? 'done' : i === 1 ? 'current' : 'pending',
      }))
    case 'agente':
      return AUDIT_PHASES.map((label, i) => ({
        label,
        state: i < 2 ? 'done' : 'current',
      }))
    case 'done':
      return AUDIT_PHASES.map((label) => ({ label, state: 'done' as const }))
    case 'cancelled':
    case 'error': {
      const stop = runningIndex >= 0 ? runningIndex : 0
      return stoppedAt(stop)
    }
    default:
      return AUDIT_PHASES.map((label) => ({ label, state: 'pending' as const }))
  }
}

// ── Pipeline de recon (Tarea 2): una etapa por herramienta ──────────────

export type PipelineStageStatus = 'done' | 'error' | 'empty' | 'gate' | 'cancelled' | 'skipped'

export interface PipelineStageSnapshot {
  toolId: string
  status: PipelineStageStatus
}

export interface PipelineSnapshotShallow {
  status: 'running' | 'done' | 'stopped' | 'cancelled'
  stages: PipelineStageSnapshot[]
}

/**
 * Deriva un segmento por etapa planificada del pipeline (Tarea 2):
 * - etapa con outcome (`done/error/empty/gate/cancelled/skipped`) → mapeado:
 *   done → verde; error/empty/gate/cancelled → rojo (paró ahí); skipped → gris.
 * - la etapa que corre AHORA (pipeline running, sin outcome aún) → current.
 * - las no empezadas → pending.
 * - pipeline done/stopped/cancelled → ninguna current: el último estado manda.
 * - `plannedToolIds`: etapas del plan que aún no tienen snapshot (empezadas a
 *   las que el snapshot aún no refleja) → pending/current.
 */
export function pipelineProgress(
  snapshot: PipelineSnapshotShallow,
  plannedToolIds: string[],
  labelsByTool: Record<string, string> = {},
): ProgressSegment[] {
  const label = (toolId: string): string => labelsByTool[toolId] ?? toolId

  const byTool = new Map<string, PipelineStageSnapshot>()
  for (const s of snapshot.stages) byTool.set(s.toolId, s)

  const stages = plannedToolIds.map((toolId) => ({ toolId, snap: byTool.get(toolId) }))

  // índice de la etapa EN MARCHA: primera sin outcome, SOLO si el pipeline
  // corre Y ninguna etapa previa falló (un fallo corta el flujo: lo posterior
  // queda muerto → pending, nunca current)
  const firstFailIdx = stages.findIndex(
    (s) => s.snap !== undefined && ['error', 'empty', 'gate', 'cancelled'].includes(s.snap.status),
  )
  const limit = firstFailIdx === -1 ? stages.length : firstFailIdx
  const currentIndex =
    snapshot.status === 'running' && limit === stages.length
      ? stages.findIndex((s) => s.snap === undefined)
      : -1

  return stages.map((s, i) => {
    const stageLabel = label(s.toolId)
    const snap = s.snap
    if (!snap) {
      return { label: stageLabel, state: i === currentIndex ? ('current' as SegState) : ('pending' as SegState) }
    }
    switch (snap.status) {
      case 'done':
        return { label: stageLabel, state: 'done' as SegState }
      case 'skipped':
        return { label: stageLabel, state: 'pending' as SegState }
      default:
        // error/empty/gate/cancelled: paró aquí (rojo) — honesto, no finge
        return { label: stageLabel, state: 'error' as SegState }
    }
  })
}
