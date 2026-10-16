import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ REPORTS_ROOT: env.root }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const orchStartCalls: { project: string; runRecon?: boolean }[] = []
vi.mock('@/server/audit-orchestrator', () => ({
  startAudit: vi.fn((input: { project: string; runRecon?: boolean }) => {
    orchStartCalls.push({ project: input.project, runRecon: input.runRecon })
    return { ok: true }
  }),
  cancelAudit: vi.fn((project: string) => project === 'demo'),
  getAuditStatus: vi.fn(() => ({ phase: 'recon', runRecon: true, startedAt: '2026-01-01T00:00:00Z' })),
}))

import {
  cancelAuditAction,
  getAuditConfigAction,
  getAuditRulesInfoAction,
  getAuditStatusAction,
  setAuditConfigAction,
  startAuditAction,
} from './audit-actions'
import { writeFileSync } from 'node:fs'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'audit-actions-'))
  env.root = root
  mkdirSync(join(root, 'demo'), { recursive: true })
  writeFileSync(
    join(root, 'demo', 'programa.json'),
    JSON.stringify({
      pid: 'x', title: 'Demo', slug: 'demo', type: 'bug-bounty', public: false, disabled: false,
      archived: false, bounty: true, bounty_reward_min: 10, bounty_reward_max: 100,
      scopes_count: 1, reports_count: 0, business_unit: null, thumbnail: null,
      user_agent: 'UA',
      rules: 'No automated scanning allowed.', scopes: [{ scope: '*.ejemplo.com', scope_type: 'web', scope_type_name: 'Web', asset_value: 'CRITICAL', report_count: null }],
      reward_grid_default: null, reward_grid_critical: null, reward_grid_high: null,
      reward_grid_medium: null, reward_grid_low: null, reward_grid_very_low: null, stats: null,
    }),
  )
  orchStartCalls.length = 0
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('startAuditAction (delegación al orquestador 12b)', () => {
  it('con recon → delega al orquestador 12b con proyecto y override', async () => {
    const res = await startAuditAction('demo', true)
    expect(res.ok).toBe(true)
    expect(res.phase).toBe('recon')
    expect(orchStartCalls).toHaveLength(1)
    expect(orchStartCalls[0]).toEqual({ project: 'demo', runRecon: true })
  })

  it('sin recon (override) → también delega', async () => {
    await startAuditAction('demo', false)
    expect(orchStartCalls[0]!.runRecon).toBe(false)
  })

  it('proyecto inexistente → error ANTES de tocar el orquestador', async () => {
    const res = await startAuditAction('no-existe', true)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/No existe el proyecto/)
    expect(orchStartCalls).toHaveLength(0)
  })
})

describe('cancelAuditAction / getAuditStatusAction (kill switch y estado)', () => {
  it('cancel sobre demo (mock: true) → ok; sobre inexistente → error del orquestador', async () => {
    expect(await cancelAuditAction('demo')).toEqual({ ok: true })
    expect(await cancelAuditAction('fantasma')).toMatchObject({ ok: false })
  })

  it('estado sin auditoría → ok con status undefined', async () => {
    const { getAuditStatus } = await import('@/server/audit-orchestrator')
    vi.mocked(getAuditStatus).mockReturnValueOnce(null)
    const res = await getAuditStatusAction('demo')
    expect(res.ok).toBe(true)
    expect(res.status).toBeUndefined()
  })
})

describe('getAuditRulesInfoAction (aviso INFORMATIVO de reglas)', () => {
  it('reglas prohibido → informativo (la UI lo muestra, el flujo no frena)', async () => {
    const res = await getAuditRulesInfoAction('demo')
    expect(res.ok).toBe(true)
    expect(res.state).toBe('prohibited')
    expect(res.reason).toBeDefined()
  })
})

describe('config 12a desde las actions', () => {
  it('set + get de la config por proyecto', async () => {
    const set = await setAuditConfigAction('demo', {
      enabled: true,
      agent: 'claude',
      budget: { maxAgents: 2 },
    })
    expect(set.ok).toBe(true)
    const get = await getAuditConfigAction('demo')
    expect(get.ok && get.config).toMatchObject({ enabled: true, agent: 'claude' })
    expect(get.ok && get.config?.budget.maxAgents).toBe(2)
    expect(await getAuditConfigAction('no-existe')).toMatchObject({ ok: true }) // config deshabilitada
  })
})
