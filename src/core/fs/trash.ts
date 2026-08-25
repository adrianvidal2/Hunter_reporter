import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from '../../lib/env'
import { moveFile } from './move'
import { resolveSafe } from './paths'

/**
 * Eliminación (paso 3.6): un fichero "eliminado" JAMÁS se borra con unlink.
 * Se mueve a `<root>/.trash/<timestamp>-<nombre>`, recuperable a mano.
 *
 * `.trash/` empieza por punto ⇒ listProjects nunca lo lista como proyecto
 * y listProject no lo escanea.
 */

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

function timestamp(d = new Date()): string {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}`
  )
}

/**
 * @param rel Ruta relativa a REPORTS_ROOT del fichero a eliminar.
 * @returns Ruta absoluta del fichero dentro de `.trash/`.
 * @throws PathEscapeError / errores de fs (ENOENT si no existe).
 */
export function trashFile(rel: string, root: string = getEnv().REPORTS_ROOT): string {
  const src = resolveSafe(rel, root) // valida escapes Y exige existencia
  const name = path.basename(src)
  const realRoot = realpathSync(root)

  // trashFile es el dueño semántico de .trash/: lo crea si falta
  mkdirSync(path.join(realRoot, '.trash'), { recursive: true })

  // Stamp de ms + contador: borrar dos ficheros con el mismo nombre nunca pisa
  let candidate = `.trash/${timestamp()}-${name}`
  let i = 2
  while (existsSync(path.join(realRoot, candidate))) {
    candidate = `.trash/${timestamp()}-${i++}-${name}`
  }

  return moveFile(rel, candidate, { root })
}
