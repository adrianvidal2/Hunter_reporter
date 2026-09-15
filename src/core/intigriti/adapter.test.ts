import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { programDetailParser, programOverviewParser, programsPageParser } from './types'
import { detailToNeutral, overviewToNeutral } from './adapter'

const here = path.dirname(fileURLToPath(import.meta.url))

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(path.join(here, '../../../docs/fixtures/intigriti', name), 'utf8'),
  ) as unknown
}

const overview = programsPageParser.parse(loadFixture('programs-page1.json')).records[0]!
const detail = programDetailParser.parse(loadFixture('program-detail.json'))

describe('overviewToNeutral', () => {
  it('mapea el item de lista', () => {
    const n = overviewToNeutral(overview)
    expect(n.platform).toBe('intigriti')
    expect(n.id).toBe('00000000-0000-4000-8000-000000000001')
    expect(n.slug).toBe('anonymized-handle-1')
    expect(n.title).toBe('Anonymized Company - Bug Bounty')
    expect(n.type).toBe('Bug Bounty')
    expect(n.status).toBe('Open')
    expect(n.isPublic).toBe(true)
    expect(n.hasBounty).toBe(true)
    expect(n.bountyMin).toBe(50)
    expect(n.bountyMax).toBe(3000)
    expect(n.scopesCount).toBe(0) // la lista no trae domains
    expect(n.businessUnit).toBeNull()
  })

  it('conserva el raw (no-lossy)', () => {
    expect(overviewToNeutral(overview).raw).toBe(overview)
  })

  it('responsible disclosure sin bounty → hasBounty false; confidentiality ≠ Public → privado', () => {
    const vdp = programOverviewParser.parse({ ...overview, id: 'x', minBounty: null, maxBounty: null, confidentialityLevel: { id: 1, value: 'Private' } })
    const n = overviewToNeutral(vdp)
    expect(n.hasBounty).toBe(false)
    expect(n.isPublic).toBe(false)
  })
})

describe('detailToNeutral', () => {
  it('mapea el detalle: scope desde domains, UA desde ROE, reglas desde la descripción', () => {
    const n = detailToNeutral(detail)
    expect(n.scopesCount).toBe(3)
    expect(n.inScope[0]).toEqual({
      target: '*.example-anonymized.com',
      type: 'Wildcard',
      typeLabel: 'Wildcard',
      assetValue: 'CRITICAL',
      reportCount: null,
    })
    expect(n.userAgent).toBe('AnonymizedProgram-UA-Required')
    expect(n.rules).toContain('Out of scope: anything not listed')
    expect(n.outOfScope).toEqual([]) // no estructurado en Intigriti
    expect(n.rewardGrids).toEqual([])
    expect(n.stats).toBeNull()
    expect(n.raw).toBe(detail)
  })
})
