import { describe, expect, it } from 'vitest'
import { buildProgramInfoMd } from './build-info'
import type { Program, Scope } from './types'

/** Programa mínimo que satisface programParser. */
function makeProgram(patch: Partial<Program> & { account_access?: string } = {}): Program {
  const scopes: Scope[] = [
    { scope: 'https://a.test', scope_type: 'web-application', scope_type_name: 'Web application', asset_value: 'HIGH', report_count: null },
    { scope: 'https://b.test', scope_type: 'mobile-application', scope_type_name: 'Mobile application', asset_value: 'LOW', report_count: null },
  ]
  return {
    pid: 'x',
    title: 'Test Program',
    slug: 'test-prog',
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
    rules: '# Reglas completas\n\nPrimera línea.\nSegunda línea sin truncar.',
    rules_html: '<h1>Reglas</h1>',
    account_access: patch.account_access ?? '',
    account_access_html: '',
    qualifying_vulnerability: ['XSS', 'SQLi'],
    non_qualifying_vulnerability: ['Clickjacking', 'Self-XSS'],
    out_of_scope: ['dominio fuera de scope 1', 'dominio fuera de scope 2'],
    scopes,
    reward_grid_default: null,
    reward_grid_critical: null,
    reward_grid_high: null,
    reward_grid_medium: null,
    reward_grid_low: null,
    reward_grid_very_low: null,
    stats: null,
    ...patch,
  }
}

describe('buildProgramInfoMd (info.md del launcher)', () => {
  it('scope IN filtrado SOLO a los assets marcados', () => {
    const md = buildProgramInfoMd(makeProgram(), { selectedScopes: ['https://a.test'], username: '', password: '' })
    expect(md).toContain('| `https://a.test` |')
    expect(md).not.toContain('https://b.test')
    expect(md).toContain('## Scope in (1)')
  })

  it('out-of-scope y reglas COMPLETOS (sin truncar) presentes', () => {
    const md = buildProgramInfoMd(makeProgram(), { selectedScopes: ['https://a.test'], username: '', password: '' })
    expect(md).toContain('dominio fuera de scope 1')
    expect(md).toContain('dominio fuera de scope 2')
    expect(md).toContain('Segunda línea sin truncar.')
    expect(md).toContain('## Vulnerabilidades aceptadas (2)')
    expect(md).toContain('- XSS')
    expect(md).toContain('- SQLi')
    expect(md).toContain('## Vulnerabilidades no aceptadas (2)')
    expect(md).toContain('- Clickjacking')
    expect(md).toContain('- Self-XSS')
  })

  it('user-agent requerido presente', () => {
    const md = buildProgramInfoMd(makeProgram(), { selectedScopes: [], username: '', password: '' })
    expect(md).toContain('## User-Agent requerido')
    expect(md).toContain('BugBounty-Test')
  })

  it('crea la sección ## Access Account si el programa no tiene apartado de cuentas', () => {
    const md = buildProgramInfoMd(makeProgram(), {
      selectedScopes: ['https://a.test'],
      username: 'testuser',
      password: 'testpass',
    })
    expect(md).toContain('## Access Account')
    expect(md).toContain('- username: testuser')
    expect(md).toContain('- password: testpass')
    expect(md).not.toContain('## Acceso a la cuenta')
  })

  it('añade username/password al apartado de cuentas existente (account_access)', () => {
    const md = buildProgramInfoMd(makeProgram({ account_access: 'You can self-register.' }), {
      selectedScopes: ['https://a.test'],
      username: 'testuser',
      password: 'testpass',
    })
    expect(md).toContain('## Acceso a la cuenta')
    expect(md).toContain('You can self-register.')
    expect(md).toContain('- username: testuser')
    expect(md).toContain('- password: testpass')
    expect(md).not.toContain('## Access Account')
  })

  it('omite la sección de credenciales si username y password están vacíos', () => {
    const md = buildProgramInfoMd(makeProgram(), { selectedScopes: ['https://a.test'], username: '', password: '' })
    expect(md).not.toContain('Access Account')
    expect(md).not.toContain('username')
    expect(md).not.toContain('password')
  })

  it('sin assets seleccionados → "sin assets seleccionados"', () => {
    const md = buildProgramInfoMd(makeProgram(), { selectedScopes: [], username: '', password: '' })
    expect(md).toContain('(sin assets seleccionados)')
    expect(md).not.toContain('| `https://a.test` |')
  })
})
