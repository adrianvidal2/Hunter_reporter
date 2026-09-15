import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { programParser, shortProgramPageParser, type Program, type ShortProgram } from './types'
import { programToNeutral, shortProgramToNeutral } from './adapter'

/** Fixtures anonimizados de 9.1 (los mismos que usan los tests del cliente). */
function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), 'docs/fixtures/ywh', name), 'utf8'),
  ) as unknown
}

const detail: Program = programParser.parse(loadFixture('program-detail.json'))
const listItem: ShortProgram = shortProgramPageParser.parse(loadFixture('programs-page1.json')).items[0]

describe('shortProgramToNeutral', () => {
  it('mapea el item de lista campo a campo', () => {
    const n = shortProgramToNeutral(listItem)
    expect(n.platform).toBe('yeswehack')
    expect(n.id).toBe('100001')
    expect(n.slug).toBe(listItem.slug)
    expect(n.title).toBe(listItem.title)
    expect(n.isPublic).toBe(listItem.public)
    expect(n.hasBounty).toBe(listItem.bounty)
    expect(n.bountyMin).toBe(listItem.bounty_reward_min)
    expect(n.bountyMax).toBe(listItem.bounty_reward_max)
    expect(n.scopesCount).toBe(listItem.scopes_count)
    expect(n.businessUnit?.currency).toBe('EUR')
  })

  it('conserva el raw de la plataforma (condición no lossy)', () => {
    const n = shortProgramToNeutral(listItem)
    expect(n.raw).toBe(listItem)
  })

  it('sin pid usa el slug como id; sin business_unit → null', () => {
    const n = shortProgramToNeutral({ ...listItem, pid: undefined, business_unit: null })
    expect(n.id).toBe(listItem.slug)
    expect(n.businessUnit).toBeNull()
  })
})

describe('programToNeutral', () => {
  it('mapea el detalle del fixture', () => {
    const n = programToNeutral(detail)
    expect(n.slug).toBe('anonymized-program-1')
    expect(n.userAgent).toBe('BugBounty-YWH-AnonymizedBrand')
    expect(n.isPublic).toBe(false)
    expect(n.inScope).toHaveLength(1)
    expect(n.inScope[0]).toEqual({
      target: 'https://example-anonymized.com/target',
      type: 'web-application',
      typeLabel: 'Web application',
      assetValue: 'HIGH',
      reportCount: null,
    })
    expect(n.outOfScope).toEqual(detail.out_of_scope)
  })

  it('incluye las grids en orden Critical..Very low (el parser hace catch(0) de los null)', () => {
    const n = programToNeutral(detail)
    expect(n.rewardGrids.map((g) => g.label)).toEqual(['Critical', 'High', 'Medium', 'Low', 'Very low'])
    expect(n.rewardGrids[1].amounts).toEqual({ low: 50, medium: 300, high: 700, critical: 1000 })
    expect(n.rewardGrids[0].amounts).toEqual({ low: 0, medium: 0, high: 0, critical: 0 })
  })

  it('mapea stats con nullables y conserva el raw completo del detalle', () => {
    const n = programToNeutral(detail)
    expect(n.stats).toEqual({
      totalReports: 15,
      maxReward: null,
      averageReward: null,
      averageFirstResponseDays: 1,
    })
    expect(n.raw).toBe(detail)
  })

  it('sin stats → null; programa sin grids → []', () => {
    const vacio = programParser.parse({ slug: 's', title: 't', stats: null })
    const n = programToNeutral(vacio)
    expect(n.stats).toBeNull()
    expect(n.rewardGrids).toEqual([])
  })
})
