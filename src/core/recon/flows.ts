/**
 * Flujos de recon aprobados (punto 2 del diseño): los fuzzers
 * (ffuf/gobuster) operan sobre HOSTS VIVOS concretos (salida de httpx), no
 * sobre el dominio del scope; el apex es último recurso con aviso.
 * sqlmap/dalfox operan sobre UNA URL del scope + ruta opcional validada.
 */

import { ReconError, isValidUrlTarget } from './tools'

/**
 * Extrae los hosts vivos de la salida de httpx (output.log de un run):
 * una URL/host por línea; se queda con el host (esquema y ruta fuera),
 * minúsculas, únicos, conservando el orden de aparición.
 */
export function parseHttpxHosts(output: string): string[] {
  const out: string[] = []
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim().toLowerCase()
    if (line === '') continue
    // httpx imprime URLs (https://host/...) o hosts; nos quedamos con el host
    const host = line.includes('://') ? line.slice(line.indexOf('://') + 3) : line
    const hostOnly = host.split('/')[0]!.split(':')[0]!.split('?')[0]!.trim()
    if (hostOnly === '' || hostOnly.startsWith('-')) continue
    if (!out.includes(hostOnly)) out.push(hostOnly)
  }
  return out
}

/** URLs http(s) dentro de una línea: katana JSON ("url":"…"), gospider
 *  ([Get] [200] …) o listas planas (gau/waybackurls/gf). Sin espacios ni
 *  comillas: la URL acaba ahí aunque vengan más campos pegados. */
const URL_RE = /https?:\/\/[^\s"'<>()\[\]{}\\]+/gi

/**
 * Extrae URLs de la salida de los crawlers/archivadores (katana -jc,
 * gospider, gau, waybackurls) y del filtrado de gf: una por aparición,
 * válidas (host con forma de dominio/IP, jamás empieza por `-`), únicas
 * y conservando el orden. Se preserva la caja (las rutas son sensibles).
 * Líneas basura y flags disfrazados (`-oN`) no producen URLs.
 */
export function parseCrawlerUrls(output: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('-')) continue
    for (const m of line.matchAll(URL_RE)) {
      // puntuación final pegada por formato de log: fuera
      const url = m[0].replace(/[.,;:!?]+$/, '')
      if (!isValidUrlTarget(url)) continue
      if (!seen.has(url)) {
        seen.add(url)
        out.push(url)
      }
    }
  }
  return out
}

/**
 * Ruta opcional para completar una URL de sqlmap/dalfox: debe empezar por
 * `/` o `?`, sin espacios, sin esquema, longitud acotada. '' = sin ruta.
 */
export function isValidUrlPath(p: string): boolean {
  if (p === '') return true
  if (typeof p !== 'string' || p.length > 500) return false
  if (!p.startsWith('/') && !p.startsWith('?')) return false
  return !/\s/.test(p)
}

/**
 * Compone la URL final para sqlmap/dalfox: target del scope (dominio o URL)
 * + ruta opcional validada. Sin texto libre: el target sale del scope y la
 * ruta pasa por isValidUrlPath.
 */
export function composeUrl(target: string, path: string): string {
  if (!isValidUrlPath(path)) throw new ReconError(`Ruta inválida: ${path}`)
  const base = target.includes('://') ? target.replace(/\/+$/, '') : `https://${target}`
  if (path === '') return base
  // '?x=1' se concatena tras el host; '/admin' igualmente
  return `${base}${path}`
}
