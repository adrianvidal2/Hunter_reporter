import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { getEnv } from '../../lib/env'
import { resolveSafeAllowMissing } from './paths'

/**
 * Escritura atómica de ficheros dentro de REPORTS_ROOT (paso 1.6).
 *
 * Garantía clave: un lector (o un fallo a mitad) nunca ve un fichero a
 * medias. El contenido se escribe en un `.tmp` oculto EN EL MISMO
 * directorio (mismo sistema de ficheros ⇒ `rename` es atómico), se hace
 * `fsync` y solo entonces se renombra sobre el destino.
 *
 * - El destino puede no existir aún: se resuelve con resolveSafeAllowMissing.
 * - Si algo falla, se limpia el `.tmp` y el original queda intacto.
 * - El nombre `.xxx.tmp` empieza por punto ⇒ listProject lo ignora.
 */

export interface WriteAtomicOptions {
  /** Root de validación. Por defecto, REPORTS_ROOT del entorno. */
  root?: string
  /** Permisos del fichero final si se crea (por defecto 0644). */
  mode?: number
}

/**
 * @param rel Ruta relativa a REPORTS_ROOT (la capa HTTP la pasa ya decodificada).
 * @param data Contenido íntegro del fichero (string UTF-8 o Buffer).
 * @returns Ruta absoluta real del fichero escrito.
 * @throws PathEscapeError si `rel` intenta salir del root.
 * @throws Error de fs (ENOENT del directorio padre, permisos…) si no se
 *         puede escribir o renombrar; en ese caso no queda ningún `.tmp`.
 */
export function writeAtomic(
  rel: string,
  data: string | Buffer,
  options: WriteAtomicOptions = {},
): string {
  const root = options.root ?? getEnv().REPORTS_ROOT
  const target = resolveSafeAllowMissing(rel, root)

  const dir = path.dirname(target)
  const tmp = path.join(
    dir,
    `.${process.pid}.${randomBytes(6).toString('hex')}.${path.basename(target)}.tmp`,
  )

  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data

  try {
    // 'wx': falla si el .tmp ya existiera (improbable: nombre aleatorio)
    const fd = openSync(tmp, 'wx', options.mode ?? 0o644)
    try {
      let offset = 0
      while (offset < buf.length) {
        offset += writeSync(fd, buf, offset, buf.length - offset)
      }
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, target)
    return target
  } catch (err) {
    // Limpieza best-effort: el .tmp no debe sobrevivir a un fallo.
    try {
      unlinkSync(tmp)
    } catch {
      // ya no existe (p. ej. si el propio open falló): no pasa nada
    }
    throw err
  }
}
