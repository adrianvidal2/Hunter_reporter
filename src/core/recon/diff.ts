import { parseHttpxHosts } from './flows'

/**
 * Diffing de superficie de ataque entre dos runs de recon (núcleo PURO).
 *
 * Un asset nuevo = superficie nueva: comparar la salida de hoy con la del
 * run anterior y resaltar lo NUEVO (subdominios, hosts vivos, URLs) es de lo
 * más útil en bug bounty. Este módulo no toca disco ni lanza procesos:
 * recibe las salidas YA leídas y devuelve el diff; el lector del árbol vive
 * en `server/recon-diff.ts`.
 */

/** Herramientas cuya salida es una lista de HOSTS (host por línea o URL). */
const HOST_TOOLS = new Set(['subfinder', 'dnsx', 'httpx'])
/** Herramientas cuya salida es una lista de URLs (http/https por línea). */
const URL_TOOLS = new Set(['gau', 'waybackurls', 'katana', 'gospider', 'waymore'])

export interface ReconDiff {
  /** En el run actual y NO en el anterior: lo nuevo (lo interesante). */
  added: string[]
  /** En el anterior y ya no en el actual: desaparecidos. */
  removed: string[]
  /** Presentes en ambos. */
  unchanged: string[]
}

/** URLs http(s) de una salida: una por línea, sin flags disfrazados, únicas
 *  y conservando el orden. Se preserva la caja (las rutas son sensibles). */
function extractUrlLines(output: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of output.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('-')) continue
    if (!/^https?:\/\//i.test(line)) continue
    if (!seen.has(line)) {
      seen.add(line)
      out.push(line)
    }
  }
  return out
}

/**
 * Items comparables de la salida de una herramienta, o null si la
 * herramienta no produce una lista de hosts/URLs que tenga sentido diffear
 * (p. ej. nmap, gf, nuclei: su salida no es un inventario de assets).
 */
export function extractReconItems(toolId: string, output: string): string[] | null {
  if (HOST_TOOLS.has(toolId)) return parseHttpxHosts(output)
  if (URL_TOOLS.has(toolId)) return extractUrlLines(output)
  return null
}

/** ¿Esta herramienta produce una lista diffeable? */
export function isDiffableTool(toolId: string): boolean {
  return HOST_TOOLS.has(toolId) || URL_TOOLS.has(toolId)
}

/**
 * Diff entre dos listas (ya extraídas y deduplicadas). El orden se conserva:
 * `added`/`unchanged` según aparecen en el actual, `removed` según el anterior.
 */
export function diffReconRuns(previous: string[], current: string[]): ReconDiff {
  const prev = new Set(previous)
  const cur = new Set(current)
  return {
    added: current.filter((x) => !prev.has(x)),
    removed: previous.filter((x) => !cur.has(x)),
    unchanged: current.filter((x) => prev.has(x)),
  }
}
