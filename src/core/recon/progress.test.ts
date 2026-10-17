import { describe, expect, it } from 'vitest'
import { auditPhaseProgress, pipelineProgress } from './progress'

const seg = (label: string, state: string) => ({ label, state })

describe('auditPhaseProgress (3 fases de la auditoría 12b)', () => {
  it('recon → [current, pending, pending]', () => {
    expect(auditPhaseProgress('recon')).toEqual([
      seg('Recon', 'current'), seg('Misión', 'pending'), seg('Agente', 'pending'),
    ])
  })

  it('mision → [done, current, pending]', () => {
    expect(auditPhaseProgress('mision')).toEqual([
      seg('Recon', 'done'), seg('Misión', 'current'), seg('Agente', 'pending'),
    ])
  })

  it('agente → [done, done, current]', () => {
    expect(auditPhaseProgress('agente')).toEqual([
      seg('Recon', 'done'), seg('Misión', 'done'), seg('Agente', 'current'),
    ])
  })

  it('done → los 3 done', () => {
    expect(auditPhaseProgress('done')).toEqual([
      seg('Recon', 'done'), seg('Misión', 'done'), seg('Agente', 'done'),
    ])
  })

  it('cancelled/error con lastRunningPhase → paró DONDE estaba (error), previos done, resto pending', () => {
    // paró en misión (el polling la vio en marcha antes del cancel)
    expect(auditPhaseProgress('cancelled', 'mision')).toEqual([
      seg('Recon', 'done'), seg('Misión', 'error'), seg('Agente', 'pending'),
    ])
    // error en agente: las dos previas done
    expect(auditPhaseProgress('error', 'agente')).toEqual([
      seg('Recon', 'done'), seg('Misión', 'done'), seg('Agente', 'error'),
    ])
    // error al principio de recon
    expect(auditPhaseProgress('error', 'recon')).toEqual([
      seg('Recon', 'error'), seg('Misión', 'pending'), seg('Agente', 'pending'),
    ])
  })

  it('cancelled/error SIN lastRunningPhase → paró al principio (honesto por defecto)', () => {
    expect(auditPhaseProgress('cancelled')).toEqual([
      seg('Recon', 'error'), seg('Misión', 'pending'), seg('Agente', 'pending'),
    ])
  })

  it('valor desconocido/null/undefined → todo pending (tolerante)', () => {
    const pending = [
      seg('Recon', 'pending'), seg('Misión', 'pending'), seg('Agente', 'pending'),
    ]
    expect(auditPhaseProgress('fase-rara')).toEqual(pending)
    expect(auditPhaseProgress(null)).toEqual(pending)
    expect(auditPhaseProgress(undefined)).toEqual(pending)
  })
})

describe('pipelineProgress (una etapa por herramienta, Tarea 2)', () => {
  const PLANNED = ['subfinder', 'dnsx', 'httpx', 'katana', 'gf']
  const LABELS = { subfinder: 'subfinder', dnsx: 'dnsx', httpx: 'httpx', katana: 'katana', gf: 'gf' }

  it('pipeline running: hechas done, la que corre current, las no empezadas pending', () => {
    const segments = pipelineProgress(
      {
        status: 'running',
        stages: [
          { toolId: 'subfinder', status: 'done' },
          { toolId: 'dnsx', status: 'done' },
          { toolId: 'httpx', status: 'error' },
        ],
      },
      PLANNED,
      LABELS,
    )
    expect(segments).toEqual([
      seg('subfinder', 'done'),
      seg('dnsx', 'done'),
      seg('httpx', 'error'),
      seg('katana', 'pending'),
      seg('gf', 'pending'),
    ])
  })

  it('la etapa EN MARCHA (sin outcome, pipeline running) → current', () => {
    const segments = pipelineProgress(
      {
        status: 'running',
        stages: [
          { toolId: 'subfinder', status: 'done' },
          { toolId: 'dnsx', status: 'done' },
        ],
      },
      PLANNED,
      LABELS,
    )
    expect(segments[2]).toEqual(seg('httpx', 'current'))
    expect(segments[3]).toEqual(seg('katana', 'pending'))
  })

  it('pipeline NO running (done): sin outcome → pending, no current (nadie está corriendo)', () => {
    const segments = pipelineProgress(
      { status: 'done', stages: [{ toolId: 'subfinder', status: 'done' }] },
      PLANNED,
      LABELS,
    )
    expect(segments[1]).toEqual(seg('dnsx', 'pending'))
  })

  it('mapeo de outcomes: empty/gate/cancelled → error (paró ahí); skipped → pending', () => {
    const segments = pipelineProgress(
      {
        status: 'stopped',
        stages: [
          { toolId: 'subfinder', status: 'done' },
          { toolId: 'dnsx', status: 'empty' },
          { toolId: 'httpx', status: 'gate' },
          { toolId: 'katana', status: 'cancelled' },
          { toolId: 'gf', status: 'skipped' },
        ],
      },
      PLANNED,
      LABELS,
    )
    expect(segments.map((s) => s.state)).toEqual(['done', 'error', 'error', 'error', 'pending'])
  })

  it('snapshot done con TODO hecho → todo verde (no finge menos ni más)', () => {
    const segments = pipelineProgress(
      {
        status: 'done',
        stages: PLANNED.map((toolId) => ({ toolId, status: 'done' as const })),
      },
      PLANNED,
      LABELS,
    )
    expect(segments.every((s) => s.state === 'done')).toBe(true)
  })

  it('labelsByTool da etiquetas legibles (p. ej. labels de RECON_TOOLS)', () => {
    const segments = pipelineProgress(
      { status: 'running', stages: [] },
      ['subfinder', 'dnsx'],
      { subfinder: 'subfinder (pasiva)', dnsx: 'dnsx (DNS)' },
    )
    expect(segments[0]!.label).toBe('subfinder (pasiva)')
    expect(segments[1]!.label).toBe('dnsx (DNS)')
  })

  it('planned vacío → []', () => {
    expect(pipelineProgress({ status: 'running', stages: [] }, [], {})).toEqual([])
  })
})
