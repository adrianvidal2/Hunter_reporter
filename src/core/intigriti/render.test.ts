import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { programDetailParser } from './types'
import { renderProgramMarkdown } from './render'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.resolve(here, '../../../docs/fixtures/intigriti')
const detailFixture = JSON.parse(readFileSync(path.join(fixtures, 'program-detail.json'), 'utf8'))

const AT = new Date('2026-09-02T12:00:00')
const renderFixture = () => renderProgramMarkdown(programDetailParser.parse(detailFixture), AT)

describe('renderProgramMarkdown (Intigriti)', () => {
  it('cabecera: nombre, handle, id, tipo/estado/visibilidad, bounty y webLink', () => {
    const md = renderFixture()
    expect(md).toMatch(/^# Anonymized Company - Bug Bounty/)
    expect(md).toContain('**Handle:** `anonymized-handle-1`')
    expect(md).toContain('**Tipo:** Bug Bounty · **Estado:** Open · **Visibilidad:** público')
    // el fixture de detalle NO trae minBounty/maxBounty (opcional en Intigriti)
    expect(md).toContain('**Bounty:** sin recompensas monetarias')
    expect(md).toContain(detailFixture.webLinks.detail)

    const conBounty = programDetailParser.parse({
      ...detailFixture,
      minBounty: { value: 50, currency: 'EUR' },
      maxBounty: { value: 3000, currency: 'EUR' },
    })
    expect(renderProgramMarkdown(conBounty, AT)).toContain('**Bounty:** 50–3000 EUR')
  })

  it('requisitos de testing: UA y requestHeader en bloques de código, intigritiMe, tooling y safe harbour', () => {
    const md = renderFixture()
    expect(md).toContain('## User-Agent requerido\n\n```\nAnonymizedProgram-UA-Required\n```')
    expect(md).toContain('## Header requerido\n\n```\nX-Anonymized-Username: {Username}\n```')
    expect(md).toContain('Safe harbour: sí.')
    expect(md).toContain('Tooling automatizado:')
  })

  it('scope IN = tabla de domains con tier y aviso de No Bounty; SIN reward grid ni stats', () => {
    const md = renderFixture()
    expect(md).toContain('## Scope in (3)')
    expect(md).toContain('| `*.example-anonymized.com` | Wildcard | Critical |')
    expect(md).toContain('«No Bounty»')
    expect(md).not.toContain('Reward grid')
    expect(md).not.toContain('Estadísticas')
    expect(md).not.toContain('Scope out')
  })

  it('reglas = descripción del ROE; footer con fecha', () => {
    const md = renderFixture()
    expect(md).toContain('## Reglas del programa')
    expect(md).toContain('Out of scope: anything not listed in the domains above.')
    expect(md).toContain('_Generado por reporter el')
  })

  it('programa no público → aviso NDA; VDP sin bounty → "sin recompensas monetarias"', () => {
    const privado = programDetailParser.parse({
      ...detailFixture,
      confidentialityLevel: { id: 1, value: 'Private' },
    })
    expect(renderProgramMarkdown(privado, AT)).toContain('PROGRAMA PRIVADO — POSIBLE NDA')

    const vdp = programDetailParser.parse({
      ...detailFixture,
      minBounty: null,
      maxBounty: null,
    })
    expect(renderProgramMarkdown(vdp, AT)).toContain('**Bounty:** sin recompensas monetarias')
  })

  it('detalle vacío (ROE null, sin domains) renderiza sin romper', () => {
    const vacio = programDetailParser.parse({
      id: 'x',
      handle: 'h',
      name: 'n',
      following: false,
      confidentialityLevel: { id: 4, value: 'Public' },
      domains: null,
      rulesOfEngagement: null,
    })
    const md = renderProgramMarkdown(vacio, AT)
    expect(md).toContain('## Scope in (0)')
    expect(md).toContain('(sin scopes declarados)')
    expect(md).not.toContain('undefined')
    expect(md).not.toContain('null')
  })
})
