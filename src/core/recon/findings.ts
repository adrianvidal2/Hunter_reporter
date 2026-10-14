import { z } from 'zod'

/**
 * Parser de findings de recon (Tarea 3, nuclei primero). Núcleo PURO:
 * recibe la salida YA leída del output.log y devuelve findings dedup.
 *
 * nuclei con `-json` emite UN objeto JSON por línea (JSONL). Como todo el
 * contenido de recon, es NO confiable (viene del objetivo): el parser es
 * tolerante campo a campo (`.catch(default)`, estilo parsers YWH) y las
 * líneas que no son hallazgos se ignoran sin romper.
 */

export const FINDING_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const

export type FindingSeverity = (typeof FINDING_SEVERITIES)[number]

export interface Finding {
  /** `template-id` de nuclei (identificador del check). */
  templateId: string
  /** Host del hit (del `host`, o deducido de `matched-at`). */
  host: string
  severity: FindingSeverity
  /** URL/ruta exacta del match, tal cual la dio nuclei. */
  matchedAt: string
  /** Nombre humano del template; si falta, el propio template-id. */
  name: string
}

/** Severidad normalizada: minúsculas; lo desconocido cae en 'info'. */
function normalizeSeverity(raw: string | undefined): FindingSeverity {
  const lower = String(raw ?? '')
    .trim()
    .toLowerCase()
  return (FINDING_SEVERITIES as readonly string[]).includes(lower)
    ? (lower as FindingSeverity)
    : 'info'
}

/** Host de una URL (o el string si ya es un host). '' si no hay nada utilizable. */
function hostOf(raw: string): string {
  const value = raw.trim()
  if (value === '') return ''
  const rest = value.includes('://') ? value.slice(value.indexOf('://') + 3) : value
  const host = (rest.split('/')[0] ?? '').split(':')[0]!.trim().toLowerCase()
  return host
}

/**
 * Esquema tolerante de UNA línea JSONL de nuclei: los campos conocidos
 * caen a su default si llegan con otro tipo o ausentes (mismo estilo que
 * los parsers de plataforma). `template-id` y un host deducible SÍ son
 * exigidos: sin ellos la línea no identifica ningún hallazgo.
 */
const nucleiLineParser = z.object({
  'template-id': z.string(),
  host: z.string().catch(''),
  'matched-at': z.string().catch(''),
  info: z
    .object({
      name: z.string().catch(''),
      severity: z.string().catch('info'),
    })
    // OJO: el catch del objeto BYPASA los defaults internos (no re-parsea):
    // hay que dar el objeto COMPLETO por defecto.
    .catch({ name: '', severity: 'info' }),
})

/**
 * Parsea la salida de nuclei (-json → JSONL) a una lista de findings:
 * - línea vacía o no-JSON → ignorada (sin romper).
 * - JSON que no es de nuclei (sin template-id, o sin host deducible) → ignorada.
 * - severidad normalizada; lo desconocido → 'info'.
 * - dedup por `template+host` (primera aparición; el orden se conserva).
 */
export function parseNucleiFindings(output: string): Finding[] {
  const out: Finding[] = []
  const seen = new Set<string>()
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || !line.startsWith('{')) continue
    let json: unknown
    try {
      json = JSON.parse(line)
    } catch {
      continue // línea malformada: ignorada
    }
    const parsed = nucleiLineParser.safeParse(json)
    if (!parsed.success) continue // no es una línea de nuclei
    const d = parsed.data
    const templateId = d['template-id'].trim()
    const host = hostOf(d.host !== '' ? d.host : d['matched-at'])
    if (templateId === '' || host === '') continue
    const key = `${templateId}\u0000${host}`
    if (seen.has(key)) continue // dedup por template+host
    seen.add(key)
    out.push({
      templateId,
      host,
      severity: normalizeSeverity(d.info.severity),
      matchedAt: d['matched-at'].trim(),
      name: d.info.name.trim() !== '' ? d.info.name.trim() : templateId,
    })
  }
  return out
}
