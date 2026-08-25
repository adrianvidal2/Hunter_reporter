import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from '../../lib/env'
import { writeAtomic } from './atomic'
import { resolveSafe } from './paths'

/**
 * Historial de versiones (paso 4.8): antes de cada guardado se archiva el
 * contenido ACTUAL del fichero en
 *
 *   <root>/.history/<ruta/relativa/del/fichero>/<timestamp>.md
 *
 * - Se retienen como mucho MAX_COPIES por fichero (se poda lo más antiguo).
 * - `.history` vive en la raíz y empieza por punto: listProjects/listProject
 *   no lo enumeran jamás.
 * - Las copias se escriben con writeAtomic y su contenido se lee ANTES de
 *   que el llamante sobrescriba el original.
 */

/** Copias retenidas por fichero (el plan fija 20). */
export const MAX_COPIES = 20

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

function timestamp(d = new Date()): string {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}`
  )
}

/** Directorio de historial de un fichero, como ruta relativa al root. */
export function historyDirFor(relPath: string): string {
  return `.history/${relPath}`
}

/**
 * Archiva el contenido actual de `rel` en su directorio de historial y poda
 * las copias que excedan MAX_COPIES.
 *
 * @returns Ruta absoluta de la copia creada, o null si el fichero no existe
 *          (nada que archivar: primer guardado de un fichero nuevo).
 */
export function saveHistoryCopy(
  rel: string,
  root: string = getEnv().REPORTS_ROOT,
): string | null {
  let src: string
  try {
    src = resolveSafe(rel, root)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }

  const dirRel = historyDirFor(rel)
  const realRoot = realpathSync(root)
  const dirAbs = path.join(realRoot, dirRel)
  mkdirSync(dirAbs, { recursive: true }) // saveHistoryCopy es dueño de su carpeta

  // Leer ANTES de que el llamante sobrescriba el original
  const content = readFileSync(src)

  let name = `${timestamp()}.md`
  let i = 2
  while (existsSync(path.join(dirAbs, name))) {
    name = `${timestamp()}-${i++}.md`
  }
  writeAtomic(`${dirRel}/${name}`, content, { root })

  prune(dirAbs)
  return path.join(dirAbs, name)
}

/** Poda las copias más antiguas por encima del máximo (orden lexicográfico
 *  de timestamps = orden cronológico). */
function prune(dirAbs: string): void {
  const entries = readdirSync(dirAbs)
    .filter((e) => e.endsWith('.md'))
    .sort()
  const excess = entries.length - MAX_COPIES
  for (let i = 0; i < excess; i++) {
    rmSync(path.join(dirAbs, entries[i]!), { force: true })
  }
}
