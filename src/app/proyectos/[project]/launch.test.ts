import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFixture, type Fixture } from '../../../test/fixtures/fixture'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ REPORTS_ROOT: env.root }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { launchProgramAction } from './launch'

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
