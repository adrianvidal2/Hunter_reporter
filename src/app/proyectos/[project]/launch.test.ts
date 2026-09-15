import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFixture, type Fixture } from '../../../test/fixtures/fixture'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ REPORTS_ROOT: env.root }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/core/orca/settings', () => ({
  loadOrcaSettings: () => ({ orcaBin: '/tmp/orca' }),
}))
const orcaState = vi.hoisted(() => ({
  agents: [] as string[],
  createImpl: null as null | ((agent: string) => Promise<{ ok: boolean; kind: string; worktreeId?: string; handle?: string; message?: string }>),
}))
vi.mock('@/core/orca/runner', () => ({
  defaultExec: async () => ({ stdout: '', stderr: '', code: 0 }),
  prepareOrcaRun: async () => ({ ok: true, startedReachable: true, opened: false, registered: true, kind: 'other' }),
  createOrcaWorktreeRun: async (input: { agent: string }) => {
    orcaState.agents.push(input.agent)
    if (orcaState.createImpl) return orcaState.createImpl(input.agent)
    return { ok: true, kind: 'other', worktreeId: `wt-${input.agent}`, handle: `h-${input.agent}` }
  },
}))

import { launchOrcaAction, launchProgramAction } from './launch'

/** Escribe un programa.json realista en el proyecto del fixture. */
function writeProgramJson(fx: Fixture, accountAccess?: string | null) {
  const projDir = path.join(fx.root, 'demo_project')
  const { mkdirSync, writeFileSync } = require('node:fs')
  mkdirSync(projDir, { recursive: true })
  const program = {
    pid: 'x',
    title: 'Demo Project',
    slug: 'example-program',
    type: 'bug-bounty',
    public: false,
    disabled: false,
    archived: false,
    bounty: true,
    bounty_reward_min: 10,
    bounty_reward_max: 100,
    scopes_count: 2,
    reports_count: 5,
    business_unit: null,
    thumbnail: null,
    user_agent: 'BugBounty-Test',
    rules: '# Reglas\n\nLínea completa sin truncar.',
    rules_html: '<h1>Reglas</h1>',
    account_access: accountAccess === undefined ? undefined : accountAccess,
    account_access_html: '',
    qualifying_vulnerability: ['XSS', 'SQLi'],
    non_qualifying_vulnerability: ['Clickjacking'],
    out_of_scope: ['dominio fuera'],
    scopes: [
      { scope: 'https://a.test', scope_type: 'web-application', scope_type_name: 'Web application', asset_value: 'HIGH', report_count: null },
      { scope: 'https://b.test', scope_type: 'web-application', scope_type_name: 'Web application', asset_value: 'LOW', report_count: null },
    ],
    reward_grid_default: null,
    reward_grid_critical: null,
    reward_grid_high: null,
    reward_grid_medium: null,
    reward_grid_low: null,
    reward_grid_very_low: null,
    stats: null,
  }
  writeFileSync(path.join(projDir, 'programa.json'), JSON.stringify(program))
  return projDir
}

describe('launchProgramAction (pestaña Programa → pentest/info.md)', () => {
  beforeEach(() => {
    env.root = ''
  })

  it('escribe info.md con scope filtrado y crea pentest/', async () => {
    const fx = createFixture()
    env.root = fx.root
    writeProgramJson(fx)

    const res = await launchProgramAction({
      project: 'demo_project',
      selectedScopes: ['https://a.test'],
      username: 'user-a',
      password: 'pass-a',
      engine: 'Claude Code',
    })

    expect(res.ok).toBe(true)
    const info = readFileSync(path.join(fx.root, 'demo_project/pentest/info.md'), 'utf8')
    expect(info).toContain('## Scope in (1)')
    expect(info).toContain('https://a.test')
    expect(info).not.toContain('https://b.test')
    expect(info).toContain('## Access Account')
    expect(info).toContain('- username: user-a')
    expect(info).toContain('- password: pass-a')
    expect(info).toContain('dominio fuera')
    expect(info).toContain('Línea completa sin truncar.')
  })

  it('añade credenciales al apartado existente (account_access) en vez de crear ## Access Account', async () => {
    const fx = createFixture()
    env.root = fx.root
    writeProgramJson(fx, 'You can self-register.')

    await launchProgramAction({
      project: 'demo_project',
      selectedScopes: ['https://a.test'],
      username: 'user-a',
      password: '',
      engine: 'Pi',
    })

    const info = readFileSync(path.join(fx.root, 'demo_project/pentest/info.md'), 'utf8')
    expect(info).toContain('## Acceso a la cuenta')
    expect(info).toContain('You can self-register.')
    expect(info).toContain('- username: user-a')
    expect(info).not.toContain('## Access Account')
  })

  it('omite la sección de credenciales si ambas están vacías', async () => {
    const fx = createFixture()
    env.root = fx.root
    writeProgramJson(fx)

    await launchProgramAction({
      project: 'demo_project',
      selectedScopes: ['https://a.test'],
      username: '',
      password: '',
      engine: 'Zcode',
    })

    const info = readFileSync(path.join(fx.root, 'demo_project/pentest/info.md'), 'utf8')
    expect(info).not.toContain('Access Account')
    expect(info).not.toContain('username')
    expect(info).not.toContain('password')
  })

  it('devuelve error si el proyecto no tiene programa.json', async () => {
    const fx = createFixture()
    env.root = fx.root
    const res = await launchProgramAction({
      project: 'sin-programa',
      selectedScopes: [],
      username: '',
      password: '',
      engine: 'Pi',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('Sin datos')
  })
})

describe('launchOrcaAction · lote de agtentes', () => {
  beforeEach(() => {
    orcaState.agents = []
    orcaState.createImpl = null
  })

  it('2 pi + 1 hermes → 3 worktrees con SU prompt y una entrada por agente en launches.json', async () => {
    const fx = createFixture()
    env.root = fx.root
    writeProgramJson(fx)

    const res = await launchOrcaAction({
      project: 'demo_project',
      selectedScopes: ['https://a.test'],
      mode: 'orca',
      agents: [
        { provider: 'pi', prompt: 'prompt A', label: 'Pi #1' },
        { provider: 'pi', prompt: 'prompt B', label: 'Pi #2' },
        { provider: 'hermes', prompt: 'prompt C', label: 'Hermes #1' },
      ],
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.providers).toHaveLength(3)
      expect(res.providers.every((p) => p.ok)).toBe(true)
      expect(res.providers.map((p) => p.label)).toEqual(['Pi #1', 'Pi #2', 'Hermes #1'])
      expect(res.providers.map((p) => p.worktreeId)).toEqual(['wt-pi', 'wt-pi', 'wt-hermes'])
    }
    expect([...orcaState.agents].sort()).toEqual(['hermes', 'pi', 'pi']) // dos pi = dos worktrees

    const launches = JSON.parse(readFileSync(path.join(fx.root, 'demo_project/pentest/launches.json'), 'utf8'))
    expect(launches.launches).toHaveLength(3)
    // una entrada por agente, con su label y su prompt ENTERO
    const byLabel = Object.fromEntries(launches.launches.map((l: Record<string, string>) => [l.label, l.prompt]))
    expect(byLabel['Pi #1']).toBe('prompt A')
    expect(byLabel['Pi #2']).toBe('prompt B')
    expect(byLabel['Hermes #1']).toBe('prompt C')
    expect(launches.launches.every((l: { ok: boolean }) => l.ok)).toBe(true)
    fx.cleanup()
  })

  it('un agente con id inválido NO aborta el resto; su entrada marca el error', async () => {
    const fx = createFixture()
    env.root = fx.root
    writeProgramJson(fx)
    // Kimi falla con unknown_agent; pi y deepseek ok
    orcaState.createImpl = async (agent) => {
      if (agent === 'kimi') return { ok: false, kind: 'unknown_agent', message: 'Unknown TUI agent' }
      return { ok: true, kind: 'other', worktreeId: `wt-${agent}`, handle: `h-${agent}` }
    }

    const res = await launchOrcaAction({
      project: 'demo_project',
      selectedScopes: [],
      mode: 'orca',
      agents: [
        { provider: 'pi', prompt: 'p1', label: 'Pi #1' },
        { provider: 'kimi', prompt: 'p2', label: 'Kimi #1' },
        { provider: 'deepseek', prompt: 'p3', label: 'Deepseek #1' },
      ],
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      const kimi = res.providers.find((p) => p.label === 'Kimi #1')
      expect(kimi?.ok).toBe(false)
      expect(kimi?.kind).toBe('unknown_agent')
      expect(kimi?.error).toMatch(/id de agente no válido en Orca/)
      expect(res.providers.filter((p) => p.ok)).toHaveLength(2) // pi y deepseek
    }
    const launches = JSON.parse(readFileSync(path.join(fx.root, 'demo_project/pentest/launches.json'), 'utf8'))
    expect(launches.launches).toHaveLength(3)
    expect(launches.launches.filter((l: { ok: boolean }) => !l.ok)).toHaveLength(1)
    expect(launches.launches.filter((l: { ok: boolean }) => !l.ok)[0]!.error).toMatch(/id de agente no válido/i)
    fx.cleanup()
  })
})
