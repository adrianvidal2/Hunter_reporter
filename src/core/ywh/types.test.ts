import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { programParser, shortProgramPageParser, shortProgramParser } from './types'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.resolve(here, '../../../docs/fixtures/ywh')
const pageFixture = JSON.parse(readFileSync(path.join(fixtures, 'programs-page1.json'), 'utf8'))
const detailFixture = JSON.parse(readFileSync(path.join(fixtures, 'program-detail.json'), 'utf8'))

describe('9.2 · tipos Zod tolerantes contra los fixtures de 9.1', () => {
  it('la página de lista parsea: 3 items (público/privado/vdp) y paginación', () => {
    const page = shortProgramPageParser.parse(pageFixture)
    expect(page.items).toHaveLength(3)
    expect(page.pagination).toEqual({
      page: 1,
      nb_pages: 2,
      results_per_page: 42,
      nb_results: 82,
    })
    expect(page.items.map((i) => i.slug)).toEqual([
      'anonymized-program-1',
      'anonymized-program-2',
      'anonymized-program-3',
    ])
    expect(page.items[0]!.public).toBe(true)
    expect(page.items[1]!.public).toBe(false) // privado (solo visible con JWT)
    expect(page.items[2]!.type).toBe('vdp-in-app')
  })

  it('el detalle parsea: scopes, UA, grids y stats nullables preservados', () => {
    const p = programParser.parse(detailFixture)
    expect(p.slug).toBe('anonymized-program-1')
    expect(p.scopes).toHaveLength(1) // programa real: 1 solo asset
    expect(p.scopes[0]).toMatchObject({
      scope: 'https://example-anonymized.com/target',
      scope_type: 'web-application',
      asset_value: 'HIGH',
      report_count: null, // null REAL observado, no falseado a 0
    })
    expect(p.user_agent).toBe('BugBounty-YWH-AnonymizedBrand')
    expect(p.reward_grid_critical).toMatchObject({ bounty_critical: 0 }) // real era null; el parser normaliza null→0
    expect(p.stats?.max_reward).toBeNull() // null real observado
    expect(p.stats?.total_reports).toBe(15)
    expect(p.qualifying_vulnerability).toHaveLength(12) // 12 aceptados reales
  })

  it('TOLERANTE: campos desconocidos extra NO rompen (se ignoran)', () => {
    const withExtra = {
      ...detailFixture,
      nuevo_campo_futuro: { algo: [1, 2, 3] },
      otro_campo: 'x',
    }
    expect(() => programParser.parse(withExtra)).not.toThrow()
    const p = programParser.parse(withExtra)
    expect(p.slug).toBe('anonymized-program-1')
    expect('nuevo_campo_futuro' in p).toBe(false) // stripped
  })

  it('TOLERANTE: drift de tipos en campos conocidos cae a defaults (estilo yeswecaido)', () => {
    const drifted = {
      ...pageFixture.items[0],
      bounty_reward_min: 'no-es-numero', // string donde esperábamos number
      scopes_count: null, // null donde esperábamos number
      business_unit: null, // sin business unit
      thumbnail: null,
      pid: '40972', // DRIFT REAL: pid llega como string en la API
    }
    const p = shortProgramParser.parse(drifted)
    expect(p.bounty_reward_min).toBe(0)
    expect(p.scopes_count).toBe(0)
    expect(p.business_unit).toBeNull()
    expect(p.thumbnail).toBeNull()
    expect(p.pid).toBe('40972') // string aceptado tal cual
    expect(p.slug).toBe('anonymized-program-1') // lo que importa, intacto
  })

  it('TOLERANTE: scopes:null en el detalle → array vacío; grids ausentes → nullish', () => {
    const sinScopes = { ...detailFixture, scopes: null, reward_grid_critical: undefined }
    const p = programParser.parse(sinScopes)
    expect(p.scopes).toEqual([])
    expect(p.reward_grid_critical).toBeUndefined()
  })

  it('item mínimo (solo lo esencial) parsea con defaults', () => {
    const min = shortProgramParser.parse({ slug: 'x' })
    expect(min).toMatchObject({
      slug: 'x',
      title: '',
      public: true,
      type: 'bug-bounty',
      scopes_count: 0,
    })
  })
})
