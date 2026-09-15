import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { programDetailParser, programsPageParser } from './types'

/** Fixtures anonimizados (docs/fixtures/intigriti, verificados en vivo). */
function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), 'docs/fixtures/intigriti', name), 'utf8'),
  ) as unknown
}

describe('parsers Intigriti', () => {
  it('parsea la página de lista (paginación {maxCount, records})', () => {
    const page = programsPageParser.parse(loadFixture('programs-page1.json'))
    expect(page.maxCount).toBe(2)
    expect(page.records).toHaveLength(2)
    const bb = page.records[0]
    expect(bb.id).toBe('00000000-0000-4000-8000-000000000001')
    expect(bb.handle).toBe('anonymized-handle-1')
    expect(bb.minBounty?.value).toBe(50)
    expect(bb.status?.value).toBe('Open')
    expect(bb.type?.value).toBe('Bug Bounty')
  })

  it('parsea el detalle con domains y ROE versionados', () => {
    const d = programDetailParser.parse(loadFixture('program-detail.json'))
    expect(d.handle).toBe('anonymized-handle-1')
    expect(d.domains?.content).toHaveLength(3)
    const first = d.domains?.content[0]
    expect(first?.endpoint).toBe('*.example-anonymized.com')
    expect(first?.type?.value).toBe('Wildcard')
    expect(first?.tier?.value).toBe('Critical')
    expect(d.rulesOfEngagement?.content.testingRequirements.userAgent).toBe('AnonymizedProgram-UA-Required')
    expect(d.rulesOfEngagement?.content.testingRequirements.requestHeader).toBe('X-Anonymized-Username: {Username}')
    expect(d.rulesOfEngagement?.content.safeHarbour).toBe(true)
  })

  it('tolera campos desconocidos y nullables reales (ROE null, money ausente, UA "")', () => {
    const d = programDetailParser.parse({
      id: 'x',
      handle: 'h',
      name: 'n',
      following: false,
      confidentialityLevel: null,
      status: null,
      type: null,
      domains: null,
      rulesOfEngagement: null,
      webLinks: null,
      industry: null,
      campoFuturo: { ignorado: true },
    })
    expect(d.domains).toBeNull()
    expect(d.rulesOfEngagement).toBeNull()
    expect(d.confidentialityLevel).toBeNull()
    const vdp = programDetailParser.parse({
      id: 'y',
      handle: 'vdp',
      name: 'VDP',
      following: false,
      confidentialityLevel: { id: 4, value: 'Public' },
      status: { id: 3, value: 'Open' },
      type: { id: 1, value: 'Bug Bounty' },
      minBounty: null,
      maxBounty: null,
    })
    expect(vdp.minBounty).toBeNull()
    const tr = programDetailParser.parse({
      id: 'z',
      handle: 'h',
      name: 'n',
      following: false,
      rulesOfEngagement: {
        content: { description: '', testingRequirements: { userAgent: '', requestHeader: '' } },
      },
    })
    expect(tr.rulesOfEngagement?.content.testingRequirements.userAgent).toBe('')
  })
})
