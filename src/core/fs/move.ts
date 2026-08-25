import { existsSync, renameSync } from 'node:fs'
import { getEnv } from '../../lib/env'
import { resolveSafe, resolveSafeAllowMissing } from './paths'

/**
 * Movimiento de ficheros dentro de REPORTS_ROOT (paso 1.7).
 *
 * - `src` debe existir (resolveSafe); `dst` puede no existir aún
 *   (resolveSafeAllowMissing).
 * - Colisión: si `dst` ya existe se lanza `ConflictError` ANTES de renombrar
 *   (un `rename` POSIX sobrescribiría silenciosamente). Mover un fichero
 *   sobre sí mismo también es colisión.
 * - El movimiento es un `rename` dentro del mismo root ⇒ mismo sistema de
 *   ficheros ⇒ atómico. Sin copia+borrado intermedia que pueda perder datos.
 * - El directorio padre de `dst` debe existir (lo garantiza createProject);
 *   si no, el ENOENT de fs se propaga tal cual.
 *
 * Nota: la comprobación existsSync→rename tiene una ventana TOCTOU
 * teórica; aceptable en una app local de un solo usuario.
 */

/** El destino ya existe: no se sobrescribe nada sin permiso explícito. */
export class ConflictError extends Error {
  constructor(dst: string) {
    super(`El destino ya existe (conflicto): ${JSON.stringify(dst)}`)
    this.name = 'ConflictError'
  }
}

export interface MoveOptions {
  /** Root de validación. Por defecto, REPORTS_ROOT del entorno. */
  root?: string
}

/**
 * @param srcRel Ruta relativa (a REPORTS_ROOT) del fichero a mover. Debe existir.
 * @param dstRel Ruta relativa destino. No debe existir.
 * @returns Ruta absoluta real del destino.
 * @throws PathEscapeError si src o dst intentan salir del root.
 * @throws ConflictError si dst ya existe (o src === dst).
 * @throws Error de fs (ENOENT…) si src no existe o el padre de dst no existe.
 */
export function moveFile(srcRel: string, dstRel: string, options: MoveOptions = {}): string {
  const root = options.root ?? getEnv().REPORTS_ROOT
  const src = resolveSafe(srcRel, root)
  const dst = resolveSafeAllowMissing(dstRel, root)

  if (existsSync(dst)) throw new ConflictError(dstRel)

  renameSync(src, dst)
  return dst
}
