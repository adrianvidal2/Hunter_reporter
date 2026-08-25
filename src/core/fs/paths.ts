import { realpathSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from '../../lib/env'

/**
 * Resolución segura de rutas relativas dentro de REPORTS_ROOT.
 *
 * - `resolveSafe`: para rutas EXISTENTES. Devuelve la ruta REAL (symlinks
 *   resueltos) si cae dentro de REPORTS_ROOT, o lanza `PathEscapeError`.
 * - `resolveSafeAllowMissing`: igual, pero admite que la ruta final (o
 *   directorios intermedios) aún no exista: se pueblan en pasos 1.6/1.7.
 *
 * Este módulo es la base de toda la seguridad de path traversal de la app
 * (batería del paso 1.3); cualquier cambio aquí debe pasar esa batería.
 */

/** La ruta pedida cae (o intenta caer) fuera de REPORTS_ROOT. */
export class PathEscapeError extends Error {
  constructor(detail: string) {
    super(`Ruta fuera de REPORTS_ROOT rechazada: ${detail}`)
    this.name = 'PathEscapeError'
  }
}

/** Patrón de ruta absoluta estilo Windows: `C:\` o `C:/`. */
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/

/** Límite duro de longitud de la ruta relativa (PATH_MAX de Linux). */
const MAX_REL_LENGTH = 4096

/** Niveles máximos de decodificación percent (anti double-encoding). */
const MAX_DECODE_LAYERS = 5

/** ¿La ruta real queda dentro del root (o es el propio root)? */
function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep)
}

/**
 * Capas de decodificación percent del input: ['a%2Fb', 'a/b'].
 * Se detiene al dejar de cambiar o al encontrar codificación inválida.
 */
function percentLayers(rel: string): string[] {
  const layers = [rel]
  let current = rel
  for (let i = 0; i < MAX_DECODE_LAYERS && current.includes('%'); i++) {
    let decoded: string
    try {
      decoded = decodeURIComponent(current)
    } catch {
      break // codificación inválida: no puede ofuscarse más allá
    }
    if (decoded === current) break
    layers.push(decoded)
    current = decoded
  }
  return layers
}

/**
 * Valida UNA capa (cruda o decodificada) contra los vectores de la batería
 * 1.3. Devuelve el motivo del rechazo, o null si la capa es válida.
 *
 * `raw` es el input original, para que el mensaje de error siempre muestre
 * lo que el atacante envió, aunque el rechazo ocurra en una capa decodificada.
 */
function layerRejection(layer: string, raw: string): string | null {
  if (layer.includes('\0')) {
    return `contiene un byte nulo: ${JSON.stringify(raw)}`
  }
  if (path.isAbsolute(layer) || layer.startsWith('\\\\') || WINDOWS_ABSOLUTE.test(layer)) {
    return `ruta absoluta no permitida: ${JSON.stringify(raw)}`
  }
  const normalized = path.normalize(layer.replace(/\\/g, '/'))
  if (normalized === '..' || normalized.startsWith('../')) {
    return `sale del root: ${JSON.stringify(raw)}`
  }
  // `..` en cualquier parte del crudo: neutraliza ofuscaciones tipo `....//`
  // (bypass de filtros de una pasada) y `..` con separadores mixtos. Las
  // rutas legítimas de esta app nunca contienen `..`: los nombres pasan por
  // sanitizeFilename y los segmentos los construye la propia app.
  if (layer.includes('..')) {
    return `contiene '..' (posible traversal ofuscado): ${JSON.stringify(raw)}`
  }
  return null
}

interface LexicalValidation {
  realRoot: string
  normalized: string
  /** Candidato absoluto (symlinks sin resolver), léxicamente dentro de realRoot. */
  candidate: string
}

/**
 * Validación léxica compartida por resolveSafe y resolveSafeAllowMissing:
 * el conjunto de rechazos es EXACTAMENTE el mismo para ambas.
 */
function lexicallyValidate(rel: string, root: string): LexicalValidation {
  if (typeof rel !== 'string') {
    throw new TypeError(`resolveSafe espera un string, recibió ${typeof rel}`)
  }
  if (rel.trim() === '') {
    throw new PathEscapeError('la ruta relativa está vacía')
  }
  if (rel.length > MAX_REL_LENGTH) {
    throw new PathEscapeError(
      `ruta demasiado larga (${rel.length} caracteres, máximo ${MAX_REL_LENGTH})`,
    )
  }

  // Cada capa de percent-encoding se valida igual que el input crudo:
  // `%2e%2e%2f` debe caer por lo mismo que caería `../`.
  //
  // IMPORTANTE: las capas decodificadas SOLO se usan para validar; la ruta
  // que se resuelve y devuelve es siempre el input CRUDO. Por eso la capa
  // HTTP debe pasar la ruta ya decodificada (los query params llegan así de
  // serie), para que lo validado y lo resuelto sean lo mismo.
  for (const layer of percentLayers(rel)) {
    const rejection = layerRejection(layer, rel)
    if (rejection) throw new PathEscapeError(rejection)
  }

  const realRoot = realpathSync(root)
  const normalized = path.normalize(rel.replace(/\\/g, '/'))
  const candidate = path.resolve(realRoot, normalized)
  if (!isInside(realRoot, candidate)) {
    throw new PathEscapeError(`sale del root: ${JSON.stringify(rel)}`)
  }
  return { realRoot, normalized, candidate }
}

/**
 * @param rel Ruta relativa a REPORTS_ROOT que DEBE existir.
 * @param root Root contra el que validar. Por defecto, REPORTS_ROOT del
 *             entorno. Inyectable para tests con fixtures en tmpdir.
 * @returns Ruta absoluta REAL (post-realpath) dentro de root.
 * @throws PathEscapeError si la ruta escapa del root (rutas absolutas,
 *         bytes nulos, '..', percent-encoding que decodifica a un escape,
 *         longitud desproporcionada o symlinks que apuntan fuera).
 * @throws Error de fs (ENOENT…) si la ruta no existe.
 */
export function resolveSafe(rel: string, root: string = getEnv().REPORTS_ROOT): string {
  const { realRoot, candidate } = lexicallyValidate(rel, root)
  const realTarget = realpathSync(candidate)
  if (!isInside(realRoot, realTarget)) {
    throw new PathEscapeError(`un symlink de la ruta apunta fuera del root: ${JSON.stringify(rel)}`)
  }
  return realTarget
}

/**
 * Como `resolveSafe`, pero para rutas que aún no existen (ficheros nuevos,
 * directorios intermedios por crear).
 *
 * Algoritmo: sube desde el candidato hasta el ancestro existente más
 * cercano, lo resuelve con `realpath` y comprueba que ese ancestro REAL
 * sigue dentro del root (un symlink intermedio que apunte fuera se detecta
 * igual que en resolveSafe). La parte restante, ya normalizada por la
 * validación léxica compartida, no puede contener '..'.
 *
 * @throws PathEscapeError con exactamente los mismos casos léxicos que
 *         resolveSafe, y además si un symlink existente de la ruta apunta
 *         fuera del root.
 */
export function resolveSafeAllowMissing(
  rel: string,
  root: string = getEnv().REPORTS_ROOT,
): string {
  const { realRoot, candidate } = lexicallyValidate(rel, root)

  let current = candidate
  const missing: string[] = []
  for (;;) {
    try {
      current = realpathSync(current)
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      const parent = path.dirname(current)
      if (parent === current) throw err // no debería ocurrir: realRoot existe
      missing.unshift(path.basename(current))
      current = parent
    }
  }

  if (!isInside(realRoot, current)) {
    throw new PathEscapeError(`un symlink de la ruta apunta fuera del root: ${JSON.stringify(rel)}`)
  }

  return missing.length === 0 ? current : path.join(current, ...missing)
}
