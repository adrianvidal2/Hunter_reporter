import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setProjectAudit } from '@/core/recon/audit-config'
import {
  cancelAudit,
  getAuditStatus,
  startAudit,
  type AuditDeps,
  type AuditState,
} from './audit-orchestrator'

/**
 * Orquestador 12b con TODAS las deps inyectadas: sin binarios, sin red,
 * sin LLM. Se prueba el encadenado (recon→misión→agente), el kill switch,
 * la regla informativa y el presupuesto.
 */

let root: string
const created: string[] = []
const originalCwd = process.cwd()

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'audit-orch-'))
  created.push(root)
  process.chdir(mkdtempSync(join(tmpdir(), 'audit-orch-settings-')))
})

afterAll(() => {
  process.chdir(originalCwd)
  for (const p of created) rmSync(p, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(join(process.cwd(), '.settings', 'audit.json'), { force: true })
  // config opt-in por defecto para 'demo'
  setProjectAudit('demo', {
    enabled: true,
    runRecon: true,
    agent: 'pi',
    budget: { tokens: 100_000, timeMs: 60_000, maxAgents: 1 },
  })
})

function baseDeps(over: Partial<AuditDeps> = {}): Required<Pick<AuditDeps, 'startPipelineImpl' | 'getPipelineImpl' | 'cancelPipelineImpl' | 'buildMissionImpl' | 'launchOrcaImpl'>> & AuditDeps {
  return {
    startPipelineImpl: vi.fn().mockReturnValue({ ok: true, pipelineId: 'pipe-1', outputDir: 'x' }),
    getPipelineImpl: vi.fn().mockReturnValue({ status: 'done' }),
    cancelPipelineImpl: vi.fn(),
    buildMissionImpl: vi.fn().mockResolvedValue({ ok: true, mission: '## Misión ensamblada' }),
    launchOrcaImpl: vi.fn().mockResolvedValue({ ok: true }),
    getContextImpl: vi.fn().mockResolvedValue({
      ok: true,
      targets: ['*.ejemplo.com'],
      userAgent: 'UA',
      rulesText: '',
      automatedTooling: null,
    }),
    sleepImpl: async (ms: number) => new Promise((r) => setTimeout(r, Math.min(ms, 20))),
    nowMs: () => Date.now(),
    ...over,
  }
}

async function waitForPhase(project: string, phases: AuditState['phase'][]): Promise<AuditState> {
  for (let i = 0; i < 200; i++) {
    const snap = getAuditStatus(project)
    if (snap && phases.includes(snap.phase)) return snap
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('timeout esperando fase del orquestador')
}

describe('startAudit (encadenado recon → misión → agente)', () => {
  it('con recon: pipeline COMPLETO con confirmed:true y DESPUÉS el agente con la misión', async () => {
    const deps = baseDeps()
    const res = startAudit({ project: 'demo' }, deps)
    expect(res.ok).toBe(true)

    const done = await waitForPhase('demo', ['done'])
    // el pipeline fue COMPLETO (plan con activo incluido) y CONFIRMADO
    const startCall = (deps.startPipelineImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      stages: string[]
      confirmed: boolean
    }
    expect(startCall.confirmed).toBe(true) // el clic ya autorizó: SIN gate
    expect(startCall.stages).toContain('nuclei') // plan COMPLETO (no solo pasivo)

    // misión → agente
    expect(deps.buildMissionImpl).toHaveBeenCalledWith('demo')
    const orcaCall = (deps.launchOrcaImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      agents: { provider: string; prompt: string }[]
      selectedScopes: string[]
    }
    expect(orcaCall.agents[0]!.prompt).toBe('## Misión ensamblada')
    expect(orcaCall.selectedScopes).toEqual(['*.ejemplo.com'])
    expect(done.phase).toBe('done')
    // traza de reglas: silent (sin reglas) — informativa
    expect(done.rulesVerdict?.state).toBe('silent')
  })

  it('saltar recon: va DIRECTO a misión→agente sin pipeline', async () => {
    const deps = baseDeps()
    const res = startAudit({ project: 'demo', runRecon: false }, deps)
    expect(res.ok).toBe(true)

    const done = await waitForPhase('demo', ['done'])
    expect(deps.startPipelineImpl).not.toHaveBeenCalled()
    expect(deps.launchOrcaImpl).toHaveBeenCalledTimes(1)
    expect(done.phase).toBe('done')
  })

  it('traza informativa: reglas en PROHIBIDO no frenan (operador manda)', async () => {
    const deps = baseDeps({
      getContextImpl: vi.fn().mockResolvedValue({
        ok: true,
        targets: ['*.ejemplo.com'],
        rulesText: 'No automated scanning allowed.',
      }),
    })
    startAudit({ project: 'demo' }, deps)
    const done = await waitForPhase('demo', ['done'])
    // NO frenó: pipeline Y agente lanzados
    expect(deps.startPipelineImpl).toHaveBeenCalledTimes(1)
    expect(deps.launchOrcaImpl).toHaveBeenCalledTimes(1)
    // pero la traza registra la prohibición
    expect(done.rulesVerdict?.state).toBe('prohibited')
  })
})

describe('kill switch (operativo)', () => {
  it('a mitad de recon: cancela el pipeline y NO lanza el agente', async () => {
    const deps = baseDeps({
      startPipelineImpl: vi.fn().mockReturnValue({ ok: true, pipelineId: 'pipe-live', outputDir: 'x' }),
      getPipelineImpl: vi.fn().mockImplementation(() => ({ status: 'running' })),
    })

    const res = startAudit({ project: 'demo' }, deps)
    expect(res.ok).toBe(true)
    await new Promise((r) => setTimeout(r, 30)) // llegar a fase recon/polling

    expect(cancelAudit('demo')).toBe(true)
    // cancelPipeline fue llamado con el pipeline en curso
    expect((deps.cancelPipelineImpl as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual(['pipe-live'])

    const snap = await waitForPhase('demo', ['cancelled'])
    expect(snap.cancelledByUser).toBe(true)
    expect(deps.launchOrcaImpl).not.toHaveBeenCalled() // el agente NO se lanza
  })

  it('cancel sin auditoría activa → false', () => {
    expect(cancelAudit('inexistente')).toBe(false)
  })
})

describe('presupuesto y config', () => {
  it('presupuesto de tiempo agotado durante el recon → corta (sin agente)', async () => {
    let now = Date.now()
    const deps = baseDeps({
      startPipelineImpl: vi.fn().mockReturnValue({ ok: true, pipelineId: 'pipe-long', outputDir: 'x' }),
      getPipelineImpl: vi.fn().mockReturnValue({ status: 'running' }),
      nowMs: () => now,
    })
    // presupuesto de tiempo corto
    setProjectAudit('demo', { enabled: true, budget: { timeMs: 5_000 } })
    startAudit({ project: 'demo' }, deps)
    await new Promise((r) => setTimeout(r, 30))

    now += 10 * 60_000 // pasar el presupuesto
    await new Promise((r) => setTimeout(r, 1_500)) // el poll usa sleep real (1s)
    const snap = await waitForPhase('demo', ['error'])
    expect(snap.error).toMatch(/Presupuesto de tiempo/i)
    expect(deps.launchOrcaImpl).not.toHaveBeenCalled()
  })

  it('maxAgents del presupuesto define cuántos agentes se lanzan', async () => {
    setProjectAudit('demo', { enabled: true, runRecon: false, budget: { maxAgents: 3 } })
    const deps = baseDeps()
    startAudit({ project: 'demo', runRecon: false }, deps)
    const done = await waitForPhase('demo', ['done'])
    expect(done.agent?.count).toBe(3)
    const orcaCall = (deps.launchOrcaImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      agents: unknown[]
    }
    expect(orcaCall.agents).toHaveLength(3)
  })

  it('config sin opt-in (enabled) → error claro y NADA se lanza', async () => {
    setProjectAudit('demo', { enabled: false })
    const deps = baseDeps()
    const res = startAudit({ project: 'demo' }, deps)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/no configurada|actívala/i)
    expect(deps.startPipelineImpl).not.toHaveBeenCalled()
    expect(deps.launchOrcaImpl).not.toHaveBeenCalled()
  })
})
