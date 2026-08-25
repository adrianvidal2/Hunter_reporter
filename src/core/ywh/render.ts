import type { Program } from './types'

/**
 * Renderiza programa.md (9.6 ampliado) desde el Program parseado
 * (los 74 campos del detalle). Función PURA: sin fs, sin red.
 */

const fmt = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : String(n)

export function renderProgramMarkdown(program: Program, generatedAt: Date = new Date()): string {
  const p = program
  const currency = p.business_unit?.currency ?? 'EUR'
  const lines: string[] = []

  lines.push(`# ${p.title || p.slug}`)
  lines.push('')
  lines.push(`**Slug:** \`${p.slug}\`${p.pid != null ? ` · **PID:** ${p.pid}` : ''}`)
  if (p.country) lines.push(`**País:** ${p.country}`)
  lines.push(
    `**Tipo:** ${p.type}${p.status ? ` · **Estado:** ${p.status}` : ''}` +
      ` · **Visibilidad:** ${p.public ? 'público' : 'PRIVADO'}`,
  )
  if (p.business_unit?.name) {
    lines.push(`**Empresa:** ${p.business_unit.name}${p.business_unit.slug ? ` (\`${p.business_unit.slug}\`)` : ''}`)
  }
  lines.push(
    p.bounty
      ? `**Bounty:** ${p.bounty_reward_min}–${p.bounty_reward_max} ${currency}`
      : '**Bounty:** sin recompensas monetarias',
  )
  lines.push('')

  if (!p.public) {
    lines.push(
      '> ⚠️ **PROGRAMA PRIVADO — POSIBLE NDA.** No compartas este documento ni su',
      '> contenido (scope, credenciales, reglas) fuera del ámbito del programa.',
      '> Trátalo como confidencial.',
      '',
    )
  }

  if (p.user_agent) {
    lines.push('## User-Agent requerido', '', '```', p.user_agent, '```', '')
  }

  lines.push(`## Scope in (${p.scopes.length})`)
  if (p.scopes.length === 0) {
    lines.push('', '(sin scopes declarados)')
  } else {
    lines.push('', '| Scope | Tipo | Valor |', '| --- | --- | --- |')
    for (const s of p.scopes) {
      lines.push(`| \`${s.scope}\` | ${s.scope_type_name ?? s.scope_type} | ${s.asset_value} |`)
    }
  }
  lines.push('')

  if (p.out_of_scope.length > 0) {
    lines.push(`## Scope out (${p.out_of_scope.length})`, '')
    for (const o of p.out_of_scope) lines.push(`- ${o}`)
    lines.push('')
  }

  const grids: [string, NonNullable<Program['reward_grid_critical']>][] = [
    ['Critical', p.reward_grid_critical],
    ['High', p.reward_grid_high],
    ['Medium', p.reward_grid_medium],
    ['Low', p.reward_grid_low],
    ['Very low', p.reward_grid_very_low],
  ].filter(([, g]) => g != null) as [string, NonNullable<Program['reward_grid_critical']>][]
  if (grids.length > 0) {
    lines.push('## Reward grid', '', '| Severidad | Low | Medium | High | Critical |', '| --- | --- | --- | --- | --- |')
    for (const [label, g] of grids) {
      lines.push(`| ${label} | ${g.bounty_low} | ${g.bounty_medium} | ${g.bounty_high} | ${g.bounty_critical} |`)
    }
    lines.push('')
  }

  if (p.stats) {
    lines.push('## Estadísticas', '')
    lines.push(`- Reportes totales: ${fmt(p.stats.total_reports)}`)
    lines.push(`- Recompensa máxima: ${fmt(p.stats.max_reward)} ${currency}`)
    lines.push(`- Recompensa media: ${fmt(p.stats.average_reward)} ${currency}`)
    lines.push(`- 1ª respuesta media (días): ${fmt(p.stats.average_first_time_response)}`)
    lines.push('')
  }

  if (p.rules) {
    lines.push('## Reglas del programa', '', p.rules, '')
  }
  if (p.qualifying_vulnerability.length > 0) {
    lines.push(`## Vulnerabilidades cualificables (${p.qualifying_vulnerability.length})`, '')
    for (const q of p.qualifying_vulnerability) lines.push(`- ${q}`)
    lines.push('')
  }
  if (p.non_qualifying_vulnerability.length > 0) {
    lines.push(`## No cualificables (${p.non_qualifying_vulnerability.length})`, '')
    for (const q of p.non_qualifying_vulnerability) lines.push(`- ${q}`)
    lines.push('')
  }
  if (p.account_access) {
    lines.push('## Acceso a la cuenta', '', p.account_access, '')
  }

  lines.push('---', '', `_Generado por reporter el ${generatedAt.toLocaleString('es')}. Crudo completo en \`programa.json\`._`, '')
  return lines.join('\n')
}
