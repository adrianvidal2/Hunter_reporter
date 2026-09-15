import type { ProgramDetail } from './types'

/**
 * Renderiza programa.md de Intigriti desde el ProgramDetail parseado.
 * Render PROPIO (no el de YWH): Intigriti no tiene reward grid ni stats ni
 * listas de cualificables; a cambio tiene ROE con User-Agent requerido,
 * requestHeader obligatorio, intigritiMe, política de tooling y safe
 * harbour. Función PURA: sin fs, sin red.
 */

const fmt = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : String(n)

const TOOLING_LABELS: Record<number, string> = {
  0: 'sin restricción declarada',
  1: 'restringido (revisa las reglas antes de automatizar)',
  2: 'prohibido',
}

export function renderProgramMarkdown(program: ProgramDetail, generatedAt: Date = new Date()): string {
  const p = program
  const lines: string[] = []
  const confidentiality = p.confidentialityLevel?.value ?? ''
  const isPublic = confidentiality.toLowerCase() === 'public'
  const type = p.type?.value ?? ''
  const status = p.status?.value ?? ''
  const minBounty = p.minBounty?.value ?? null
  const maxBounty = p.maxBounty?.value ?? null
  const currency = p.maxBounty?.currency ?? p.minBounty?.currency ?? 'EUR'
  const domains = p.domains?.content ?? []
  const roe = p.rulesOfEngagement?.content ?? null
  const ua = roe?.testingRequirements.userAgent || null
  const requestHeader = roe?.testingRequirements.requestHeader || null

  lines.push(`# ${p.name || p.handle}`)
  lines.push('')
  lines.push(`**Handle:** \`${p.handle}\`${p.id ? ` · **ID:** ${p.id}` : ''}`)
  if (p.industry) lines.push(`**Industria:** ${p.industry}`)
  lines.push(
    `${type ? `**Tipo:** ${type}` : ''}${status ? `${type ? ' · ' : ''}**Estado:** ${status}` : ''}` +
      ` · **Visibilidad:** ${isPublic ? 'público' : 'PRIVADO'}`,
  )
  if (minBounty !== null || maxBounty !== null) {
    lines.push(`**Bounty:** ${fmt(minBounty)}–${fmt(maxBounty)} ${currency}`)
  } else {
    lines.push('**Bounty:** sin recompensas monetarias')
  }
  if (p.webLinks?.detail) lines.push(`**Web:** ${p.webLinks.detail}`)
  lines.push('')

  if (!isPublic) {
    lines.push(
      '> ⚠️ **PROGRAMA PRIVADO — POSIBLE NDA.** No compartas este documento ni su',
      '> contenido (scope, credenciales, reglas) fuera del ámbito del programa.',
      '> Trátalo como confidencial.',
      '',
    )
  }

  if (ua) {
    lines.push('## User-Agent requerido', '', '```', ua, '```', '')
  }
  if (requestHeader) {
    lines.push('## Header requerido', '', '```', requestHeader, '```', '')
  }
  if (roe) {
    const tr = roe.testingRequirements
    const roeLines: string[] = []
    if (tr.intigritiMe) roeLines.push('- Debes usar tu nombre de usuario de Intigriti (`intigritiMe`).')
    if (tr.automatedTooling !== null && tr.automatedTooling !== undefined) {
      roeLines.push(`- Tooling automatizado: ${TOOLING_LABELS[tr.automatedTooling] ?? `política ${tr.automatedTooling}`}.`)
    }
    roeLines.push(`- Safe harbour: ${roe.safeHarbour ? 'sí' : 'NO declarado'}.`)
    lines.push('## Requisitos de testing', '', ...roeLines, '')
  }

  // Scope IN: en Intigriti ES la lista de domains (no hay out-of-scope
  // estructurado: vive en las reglas).
  lines.push(`## Scope in (${domains.length})`)
  if (domains.length === 0) {
    lines.push('', '(sin scopes declarados)')
  } else {
    lines.push('', '| Endpoint | Tipo | Tier | Descripción |', '| --- | --- | --- | --- |')
    for (const d of domains) {
      const desc = (d.description || '').replace(/\|/g, '\\|').replace(/\n+/g, ' ')
      lines.push(`| \`${d.endpoint}\` | ${d.type?.value ?? '—'} | ${d.tier?.value ?? '—'} | ${desc} |`)
    }
    const noBounty = domains.filter((d) => d.tier?.value.toLowerCase() === 'no bounty')
    if (noBounty.length > 0) {
      lines.push('')
      lines.push(
        `> ⚠️ ${noBounty.length} scope(s) «No Bounty» (reportables, sin recompensa): ` +
          noBounty.map((d) => `\`${d.endpoint}\``).join(', ') +
          '.',
      )
    }
  }
  lines.push('')

  if (roe?.description) {
    lines.push('## Reglas del programa', '', roe.description, '')
  }

  lines.push('---', '', `_Generado por reporter el ${generatedAt.toLocaleString('es')}. Crudo completo en \`programa.json\`._`, '')
  return lines.join('\n')
}
