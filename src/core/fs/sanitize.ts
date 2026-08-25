/**
 * Sanitizado de NOMBRES de fichero (no rutas completas: para eso está
 * resolveSafe / resolveSafeAllowMissing en paths.ts).
 *
 * Reglas del plan (paso 1.2):
 * - elimina `/`, `\`, secuencias `..` y caracteres de control
 * - normaliza a NFC
 * - como mucho 200 bytes UTF-8, recortando sin partir caracteres
 */

/** El nombre queda vacío tras sanitizar: no es un nombre usable. */
export class InvalidFilenameError extends Error {
  constructor(raw: string) {
    super(`El nombre de fichero queda vacío tras sanitizar: ${JSON.stringify(raw)}`)
    this.name = 'InvalidFilenameError'
  }
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g
const MAX_BYTES = 200

export function sanitizeFilename(name: string): string {
  if (typeof name !== 'string') {
    throw new TypeError(`sanitizeFilename espera un string, recibió ${typeof name}`)
  }

  let out = name
    .normalize('NFC') // forma canónica Unicode
    .replace(CONTROL_CHARS, '') // sin caracteres de control (C0, DEL, C1)
    .replace(/[/\\]/g, '') // sin separadores de ningún estilo
    .replace(/\.\.+/g, '') // sin '..' (ni '...'): neutraliza traversal

  // Límite de bytes sin romper un carácter por la mitad
  if (Buffer.byteLength(out, 'utf8') > MAX_BYTES) {
    let bytes = 0
    let truncated = ''
    for (const ch of out) {
      const size = Buffer.byteLength(ch, 'utf8')
      if (bytes + size > MAX_BYTES) break
      truncated += ch
      bytes += size
    }
    out = truncated
  }

  if (out === '') throw new InvalidFilenameError(name)
  return out
}
