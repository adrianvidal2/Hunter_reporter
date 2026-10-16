import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

import { buildMissionAction, launchOrcaAction, launchProgramAction, renderKbContextAction } from './launch'
import { createKb } from '@/core/kb/kb'

/** Escribe un programa.json realista en el proyecto del fixture. */
function writeProgramJson(fx: Fixture, accountAccess?: string | null) {
  const projDir = path.join(fx.root, 'demo_project')
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

describe('renderKbContextAction (skills KB para el wizard Lanzar, Tarea 6c)', () => {
  it('devuelve el contexto de las entradas EXACTAMENTE marcadas; [] → vacío', async () => {
    const fx = createFixture()
    env.root = fx.root
    await createKb(
      { name: 'sqli-playbook', description: 'Pasos de SQLi.', category: 'tecnica', body: 'CUERPO-SQLI' },
      { scope: 'global', root: fx.root },
    )
    await createKb(
      { name: 'idor-de-demo', description: 'IDOR específico de demo.', category: 'tecnica', body: 'CUERPO-IDOR-DEMO' },
      { scope: 'demo_project', root: fx.root },
    )
    await createKb(
      { name: 'idor-de-otro', description: 'IDOR de OTRO proyecto.', category: 'tecnica', body: 'CUERPO-OTRO' },
      { scope: 'otro_project', root: fx.root },
    )

    // solo lo marcado, en orden
    const both = await renderKbContextAction(['idor-de-demo', 'sqli-playbook'], 'demo_project')
    expect(both.ok).toBe(true)
    if (both.ok) {
      expect(both.context).toContain('CUERPO-IDOR-DEMO')
      expect(both.context).toContain('CUERPO-SQLI')
      expect(both.context.indexOf('CUERPO-IDOR-DEMO')).toBeLessThan(both.context.indexOf('CUERPO-SQLI'))
    }

    // aisLAMIENTO: la entrada de OTRO proyecto no sale para demo_project
    const solo = await renderKbContextAction(['idor-de-otro'], 'demo_project')
    expect(solo.ok).toBe(true)
    if (solo.ok) expect(solo.context).toBe('') // no existe para este proyecto

    // sin proyecto, solo global
    const globalOnly = await renderKbContextAction(['idor-de-demo'])
    expect(globalOnly.ok).toBe(true)
    if (globalOnly.ok) expect(globalOnly.context).toBe('')

    // [] → cadena vacía
    const empty = await renderKbContextAction([], 'demo_project')
    expect(empty.ok && empty.context).toBe('')
    fx.cleanup()
  })
})

describe('buildMissionAction (semilla de misión 7e: ensamblar ≠ ejecutar)', () => {
  it('ensambla OpenAPI + gaps + secretos + jsSinMap + scope; y NO lanza nada', async () => {
    const fx = createFixture()
    env.root = fx.root
    writeProgramJson(fx)
    const harvestRel = 'demo_project/pentest/recon/js/20260101-000000'
    const harvestAbs = path.join(fx.root, harvestRel)
    mkdirSync(harvestAbs, { recursive: true })
    writeFileSync(path.join(harvestAbs, 'openapi.json'), JSON.stringify({ paths: { '/api/v1/users/{id}': { get: {} } } }))
    writeFileSync(path.join(harvestAbs, 'gaps.json'), JSON.stringify({ gaps: [{ reason: 'dynamic-template', snippet: 'fetch(`/api/${id}`)' }] }))
    writeFileSync(path.join(harvestAbs, 'secrets.json'), JSON.stringify({ findings: [{ kind: 'aws-access-key', confidence: 'candidato', value: 'AKIAQWMHXN3FAKEKEY99' }] }))
    writeFileSync(path.join(harvestAbs, 'coverage.json'), JSON.stringify({ coverage: [{ url: 'https://app.ejemplo.com/app.min.js', status: 'no-map' }] }))

    const res = await buildMissionAction('demo_project')
    expect(res.ok).toBe(true)
    expect(res.harvestDirRel).toBe(harvestRel)
    const mission = res.mission!
    expect(mission).toContain('/api/v1/users/{id}')
    expect(mission).toContain('fetch(`/api/${id}`)') // hueco dinámico señalado
    expect(mission).toContain('[js-sin-sourcemap]') // hueco de cobertura señalado
    expect(mission).toContain('AKIAQWMHXN3FAKEKEY99')
    expect(mission).toContain('https://a.test') // scope desde programa.json

    // ensamblar ≠ ejecutar: NADA se lanzó (sin launches.json)
    expect(existsSync(path.join(fx.root, 'demo_project/pentest/launches.json'))).toBe(false)
    fx.cleanup()
  })

  it('auto-descubre el harvest más RECIENTE que tenga openapi.json; las hipótesis salen de la KB', async () => {
    const fx = createFixture()
    env.root = fx.root
    writeProgramJson(fx)
    const oldDir = path.join(fx.root, 'demo_project/pentest/recon/js/20260101-000000')
    const newDir = path.join(fx.root, 'demo_project/pentest/recon/js/20260102-000000')
    mkdirSync(oldDir, { recursive: true })
    mkdirSync(newDir, { recursive: true })
    writeFileSync(path.join(oldDir, 'openapi.json'), JSON.stringify({ paths: { '/old': { get: {} } } }))
    writeFileSync(path.join(newDir, 'openapi.json'), JSON.stringify({ paths: { '/new': { get: {} } } }))
    // hipótesis de 07d ya persistidas en la KB del proyecto
    createKb(
      {
        name: 'js-bola-1-20260102-1200-ab12',
        description: 'Hipótesis LLM (bola) — lead sin confirmar (07d)',
        category: 'tecnica',
        tags: ['js-audit', 'bola', 'lead'],
        body: '## Hipótesis: BOLA en /new\n\n- Lead best-effort.',
      },
      { scope: 'demo_project', root: fx.root },
    )

    const res = await buildMissionAction('demo_project')
    expect(res.ok).toBe(true)
    expect(res.harvestDirRel).toContain('20260102-000000')
    expect(res.mission).toContain('/new')
    expect(res.mission).toContain('Hipótesis: BOLA en /new') // desde la KB de 07d
    expect(res.mission).not.toContain('"/old"')
    fx.cleanup()
  })

  it('sin harvest → error claro', async () => {
    const fx = createFixture()
    env.root = fx.root
    writeProgramJson(fx)
    const res = await buildMissionAction('demo_project')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/harvest/i)
    fx.cleanup()
  })
})
