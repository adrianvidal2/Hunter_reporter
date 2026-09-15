/**
 * Flujos de recon aprobados (punto 2 del diseño): los fuzzers
 * (ffuf/gobuster) operan sobre HOSTS VIVOS concretos (salida de httpx), no
 * sobre el dominio del scope; el apex es último recurso con aviso.
 * sqlmap/dalfox operan sobre UNA URL del scope + ruta opcional validada.
 */

import { ReconError } from './tools'

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
