/**
 * Front-matter YAML mínimo con PRESERVACIÓN TOTAL del formato (paso 4.10).
 *
 * Objetivo: round-trip sin pérdida sobre front-matter escrito a mano.
 * Guardar sin tocar nada debe dejar el fichero byte a byte idéntico:
 * orden de claves, estilo de comillas, comentarios, campos desconocidos,
 * líneas anidadas y el body íntegro.
 *
 * Estrategia: NO se usa un parser YAML genérico (re-serializar perdería
 * estilo). Se trabaja línea a línea y solo se reescriben las líneas cuyo
 * valor cambia; todo lo demás se copia crudo.
 *
 * Tolerante: los reportes reales pueden no tener front-matter (empiezan
 * con `# título`); en ese caso el panel parte de vacío y añadir un
 * metadato inserta el bloque al inicio.
 */

/** Las claves que gestiona el panel (4.10; cvss_vector añadido con la
 *  calculadora CVSS). */
export type MetaField = 'title' | 'severity' | 'cvss' | 'state' | 'cvss_vector'
export type MetaValues = Partial<Record<MetaField, string>>

export interface FmLine {
  /** Línea completa original, sin EOL. */
  raw: string
  /** Clave si la línea es `clave: valor` (top-level); si no, null. */
  key: string | null
}

const KEY_LINE = /^([ \t]*)([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*:[ \t]?(.*)$/

/** ¿Es línea `clave: valor` top-level? (las anidadas llevan indent mayor
 *  que la clave padre… aproximación suficiente: solo nos importan las
 *  claves del panel, que viven sin indent). */
function parseLine(raw: string): FmLine {
  const m = KEY_LINE.exec(raw)
  if (!m || m[1]!.length > 0) return { raw, key: null }
  return { raw, key: m[2]!, valuePart: m[3]! } as FmLine & { valuePart: string }
}

export interface Split {
  /** ¿Empieza el documento con un bloque front-matter válido? */
  hasFm: boolean
  /** Líneas del bloque (sin los `---`). */
  lines: string[]
  /** Texto tras la línea de cierre, EXACTO (incluye EOLs propios). */
  body: string
  /** EOL dominante del documento. */
  eol: string
}

const isOpen = (l: string) => l === '---'
const isClose = (l: string) => l === '---' || l === '...'

export function splitFrontMatter(raw: string): Split {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split('\n')
  if (lines.length === 0 || !isOpen(lines[0]!.replace(/\r$/, ''))) {
    return { hasFm: false, lines: [], body: raw, eol }
  }
  const closeIdx = lines.findIndex((l, i) => i > 0 && isClose(l.replace(/\r$/, '')))
  if (closeIdx === -1) {
    // abre pero nunca cierra: no es front-matter, es body raro
    return { hasFm: false, lines: [], body: raw, eol }
  }
  const fmLines = lines.slice(1, closeIdx).map((l) => l.replace(/\r$/, ''))
  const body = lines.slice(closeIdx + 1).join('\n')
  return { hasFm: true, lines: fmLines, body, eol }
}

/** Valor sin comillas para mostrar/editar (mínimo: dobles, simples, plain).
 *  En plain, ` #…` es comentario de YAML: no se muestra. */
export function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  return value.replace(/\s+#.*$/, '').trimEnd()
}

/** ¿Puede escribirse sin comillas sin cambiar de significado en YAML? */
const PLAIN_SAFE = /^[A-Za-z0-9À-ÿ_.:/ ()+\-]+$/
const PLAIN_UNSAFE_WORDS = /^(true|false|null|yes|no|on|off|~)$/i

function canBePlain(value: string): boolean {
  if (value.trim() === '') return false
  if (PLAIN_UNSAFE_WORDS.test(value)) return false
  if (/^[-?#&*!|>%@`"',{\[\]]/.test(value)) return false // YAML especial al inicio
  if (value.includes(' #')) return false // comentario pegado
  return PLAIN_SAFE.test(value)
}

function quote(value: string, style: 'plain' | 'double' | 'single' | 'keep', previous: string): string {
  if (value === '') return "''"
  if (style === 'single' || (style === 'keep' && previous.startsWith("'"))) {
    return `'${value.replace(/'/g, "''")}'`
  }
  if (style === 'double' || (style === 'keep' && previous.startsWith('"'))) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  if (canBePlain(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function findLine(lines: string[], field: MetaField): number {
  return lines.findIndex((l) => {
    const parsed = parseLine(l)
    return parsed.key !== null && parsed.key.toLowerCase() === field
  })
}

/** Valores actuales de las claves del panel (case-insensitive). */
export function getMeta(raw: string): MetaValues {
  const split = splitFrontMatter(raw)
  if (!split.hasFm) return {}
  const out: MetaValues = {}
  for (const field of ['title', 'severity', 'cvss', 'state', 'cvss_vector'] as MetaField[]) {
    const idx = findLine(split.lines, field)
    if (idx !== -1) {
      const parsed = parseLine(split.lines[idx]!) as FmLine & { valuePart: string }
      out[field] = unquote(parsed.valuePart.trim())
    }
  }
  return out
}

// Nota: getMeta se usa también dentro de updateMeta para decidir si una
// línea cambia; con comentarios, el valor “actual” sin comentario difiere
// del crudo, pero solo provoca reescritura si el usuario edita el campo.

/**
 * Edita los metadatos SIN tocar nada más. Devuelve el documento completo.
 *
 * - Valor idéntico al actual → esa clave no se toca.
 * - Ningún cambio efectivo → devuelve `raw` IDÉNTICO (misma referencia).
 * - Valor vacío → elimina la línea de esa clave.
 * - Clave nueva con front-matter → se añade al final del bloque.
 * - Sin front-matter y hay cambios → inserta bloque al inicio.
 * - La clave existente conserva su nombre exacto (p. ej. `Severity:`)
 *   y su estilo de comillas.
 */
export function updateMeta(raw: string, changes: MetaValues): string {
  const split = splitFrontMatter(raw)

  // Filtrar cambios reales (nuevo valor distinto del actual)
  const effective: MetaValues = {}
  const current = getMeta(raw)
  for (const [field, value] of Object.entries(changes) as [MetaField, string][]) {
    if ((current[field] ?? '') !== value) effective[field] = value
  }
  if (Object.keys(effective).length === 0) return raw

  if (!split.hasFm) {
    // Insertar bloque nuevo al inicio con las claves no vacías
    const eol = split.eol
    const newLines = (Object.entries(effective) as [MetaField, string][])
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${k}: ${quote(v, 'keep', '')}`)
    if (newLines.length === 0) return raw
    return `---${eol}${newLines.join(eol)}${eol}---${eol}${eol}${raw}`
  }

  const lines = [...split.lines]
  for (const [field, value] of Object.entries(effective) as [MetaField, string][]) {
    const idx = findLine(lines, field)
    if (value === '') {
      if (idx !== -1) lines.splice(idx, 1)
      continue
    }
    if (idx === -1) {
      lines.push(`${field}: ${quote(value, 'keep', '')}`)
    } else {
      const parsed = parseLine(lines[idx]!) as FmLine & { valuePart: string }
      const prevValue = parsed.valuePart
      const keyPart = parsed.key! // conserva nombre/espaciado original
      const style = prevValue.startsWith('"') ? 'double' : prevValue.startsWith("'") ? 'single' : 'keep'
      lines[idx] = `${keyPart}: ${quote(value, style, prevValue)}`
    }
  }
  return rebuild(split, lines)
}

function rebuild(split: Split, lines: string[]): string {
  const { eol, body } = split
  const fm = lines.length > 0 ? lines.join(eol) + eol : ''
  return `---${eol}${fm}---${eol}${body}`
}
