import { describe, expect, it } from 'vitest'
import { CVSS_LEVELS, currencySymbol, rewardRows, type RewardRow } from './reward'
import type { Program, Scope } from './types'

function makeProgram(patch: Partial<Program> = {}): Program {
  const scopes: Scope[] = [
    { scope: 'https://a.test', scope_type: 'web-application', scope_type_name: 'Web application', asset_value: 'HIGH', report_count: null },
  ]
  return {
    pid: 'x',
    title: 'Demo',
    slug: 'demo',
    type: 'bug-bounty',
    public: false,
    disabled: false,
    archived: false,
    bounty: true,
    bounty_reward_min: 50,
    bounty_reward_max: 1000,
    scopes_count: 1,
    reports_count: 5,
    business_unit: { name: 'BU', slug: 'bu', description: '', currency: 'EUR' },
    thumbnail: null,
    user_agent: 'UA',
    rules: '',
    rules_html: '',
    account_access: '',
    account_access_html: '',
    qualifying_vulnerability: [],
    non_qualifying_vulnerability: [],
    out_of_scope: [],
    scopes,
    reward_grid_default: null,
    reward_grid_very_low: null,
    reward_grid_low: null,
    reward_grid_medium: null,
    reward_grid_high: null,
    reward_grid_critical: null,
    stats: null,
    ...patch,
  }
}

describe('rewardRows (interpretación correcta: importes CVSS por asset value)', () => {
  it('dato real de Demo: un asset HIGH → UNA fila con Low50/Med300/High700/Crit1000', () => {
    const p = makeProgram({
      reward_grid_high: { bounty_low: 50, bounty_medium: 300, bounty_high: 700, bounty_critical: 1000 },
    })
    const rows = rewardRows(p)
    expect(rows).toHaveLength(1) // NO una matriz con ceros
    expect(rows[0]).toEqual({
      value: 'HIGH',
      amounts: { Low: 50, Medium: 300, High: 700, Critical: 1000 },
    })
  })

  it('default todo-null se ignora (no genera fila fantasma)', () => {
    // el parser convierte null→0 (z.number().catch(0)); con 0s no hay filas
    const p = makeProgram({ reward_grid_default: { bounty_low: 0, bounty_medium: 0, bounty_high: 0, bounty_critical: 0 } })
    expect(rewardRows(p)).toHaveLength(0)
  })

  it('niveles con 0/null se omiten', () => {
    // datos crudos de la API: pueden traer null/0 en franjas vacías
    const p = makeProgram({
      reward_grid_high: { bounty_low: 0, bounty_medium: 300, bounty_high: null, bounty_critical: 1000 } as unknown as NonNullable<Program['reward_grid_high']>,
    })
    const amounts = rewardRows(p)[0]!.amounts
    expect(amounts).toEqual({ Medium: 300, Critical: 1000 })
    expect(amounts.Low).toBeUndefined()
    expect(amounts.High).toBeUndefined()
  })

  it('usa el default si el asset value no tiene grid propio', () => {
    const p = makeProgram({
      reward_grid_high: null,
      reward_grid_default: { bounty_low: 5, bounty_medium: 20, bounty_high: 50, bounty_critical: 100 },
    })
    const rows = rewardRows(p)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.amounts.Critical).toBe(100)
  })

  it('varios assets con distinto value → una fila por cada uno', () => {
    const p = makeProgram({
      scopes: [
        { scope: 'https://a.test', scope_type: 'web-application', scope_type_name: 'Web application', asset_value: 'HIGH', report_count: null },
        { scope: 'https://b.test', scope_type: 'web-application', scope_type_name: 'Web application', asset_value: 'LOW', report_count: null },
      ],
      reward_grid_high: { bounty_low: 50, bounty_medium: 300, bounty_high: 700, bounty_critical: 1000 },
      reward_grid_low: { bounty_low: 5, bounty_medium: 10, bounty_high: 25, bounty_critical: 50 },
    })
    const rows: RewardRow[] = rewardRows(p)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.value).sort()).toEqual(['HIGH', 'LOW'])
  })

  it('CVSS_LEVELS en orden y currencySymbol', () => {
    expect([...CVSS_LEVELS]).toEqual(['Low', 'Medium', 'High', 'Critical'])
    expect(currencySymbol('EUR')).toBe('€')
    expect(currencySymbol(null)).toBe('€')
    expect(currencySymbol('USD')).toBe('USD')
  })
})
