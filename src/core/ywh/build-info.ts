import type { Program, Scope } from './types'

/**
 * Genera el contenido de `pentest/info.md` (launcher de programa, pestaña
 * Programa). Función PURA: sin fs, sin red, sin estado → fácil de testear.
 *
 * Contenido (según especificación):
 * - Título, User-Agent requerido, out-of-scope (texto COMPLETO) y reglas
 *   del programa (completas, sin truncar).
 * - Vulnerabilidades aceptadas y no aceptadas (listas enteras).
 * - Scope IN con SOLO los assets marcados en el paso 1.
 * - Credenciales (acceso de test):
 *   · si el programa ya tiene campo/apartado de cuentas de acceso
 *     (`account_access`), se añaden ahí username y password;
 *   · si no, se crea la sección `## Access Account` con esas líneas;
 *   · si ambos están vacíos, se omite la sección por completo.
 *
 * Si `info.md` ya existe, se sobrescribe (responsabilidad del caller).
 */

export interface ProgramInfoOpts {
  /** Assets del scope IN marcados (cadenas `scope`). */
  selectedScopes: string[]
  username: string
  password: string
}

export function buildProgramInfoMd(program: Program, opts: ProgramInfoOpts): string {
  const lines: string[] = []

  lines.push(`# ${program.title || program.slug}`)
  lines.push('')

  if (program.user_agent) {
    lines.push('## User-Agent requerido', '', '```', program.user_agent, '```', '')
  }

  // Scope IN filtrado a lo marcado
  const selected = new Set(opts.selectedScopes)
  const scopes: Scope[] = program.scopes.filter((s) => selected.has(s.scope))
  lines.push(`## Scope in (${scopes.length})`)
  if (scopes.length === 0) {
    lines.push('', '(sin assets seleccionados)')
  } else {
    lines.push('', '| Scope | Tipo | Valor |', '| --- | --- | --- |')
    for (const s of scopes) {
      lines.push(`| \`${s.scope}\` | ${s.scope_type_name ?? s.scope_type} | ${s.asset_value} |`)
    }
  }
  lines.push('')

  if (program.out_of_scope.length > 0) {
    lines.push(`## Scope out (${program.out_of_scope.length})`, '')
    // Texto COMPLETO, sin truncar
    for (const o of program.out_of_scope) lines.push(`- ${o}`)
    lines.push('')
  }

  if (program.rules) {
    lines.push('## Reglas del programa', '', program.rules, '')
  }

  if (program.qualifying_vulnerability.length > 0) {
    lines.push(
      `## Vulnerabilidades aceptadas (${program.qualifying_vulnerability.length})`,
      '',
    )
    for (const q of program.qualifying_vulnerability) lines.push(`- ${q}`)
    lines.push('')
  }
  if (program.non_qualifying_vulnerability.length > 0) {
    lines.push(
      `## Vulnerabilidades no aceptadas (${program.non_qualifying_vulnerability.length})`,
      '',
    )
    for (const q of program.non_qualifying_vulnerability) lines.push(`- ${q}`)
    lines.push('')
  }

  // Credenciales de acceso (test). Omitir si ambos vacíos.
  const hasCreds = opts.username !== '' || opts.password !== ''
  if (hasCreds) {
    if (program.account_access) {
      // El programa ya tiene apartado de cuentas de acceso → añadir ahí.
      lines.push('## Acceso a la cuenta', '', program.account_access, '')
    } else {
      lines.push('## Access Account', '')
    }
    if (opts.username !== '') lines.push(`- username: ${opts.username}`)
    if (opts.password !== '') lines.push(`- password: ${opts.password}`)
    lines.push('')
  }

  lines.push('---', '', `_Generado por reporter (launcher de programa). Crudo completo en \`programa.json\`._`, '')
  return lines.join('\n')
}
