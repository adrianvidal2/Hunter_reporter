import { realpathSync } from 'node:fs'

/**
 * Registro de escrituras de la propia app (revisión del flujo Pendientes).
 *
 * El watcher del 6.x registra CUALQUIER cambio bajo <proyecto>/reportes/ en
 * pending_actions — incluidos los autosaves del editor, que acababan
 * alimentando Pendientes. Este registro permite a las escrituras de la app
 * (saveFileAction, aceptar reescritura, mover a proyecto) declarar "yo acabo
 * de escribir este fichero con este hash" para que el watcher las distinga
 * de los ficheros que llegan de fuera (API de ingesta, copias a mano).
 *
 * - La comparación es POR CONTENIDO (hash), no por ventana temporal: un
 *   fichero externo posterior con contenido distinto se detecta siempre.
 * - TTL de 5 minutos por entrada: si el evento del watcher nunca llega
 *   (p. ej. el fichero se borra justo tras guardar), la entrada expira sola
 *   y el mapa no crece indefinidamente en sesiones largas.
 * - Mapa en globalThis: sobrevive al hot-reload de dev sin duplicarse.
 */

const TTL_MS = 5 * 60_000

interface Entry {
  hash: string
  at: number
}

const globalStore = globalThis as typeof globalThis & {
  __reporterOwnWrites?: Map<string, Entry>
}

function store(): Map<string, Entry> {
  return (globalStore.__reporterOwnWrites ??= new Map())
}

/** Clave normalizada: realpath del absPath (mismo criterio que el watcher). */
function key(absPath: string): string {
  try {
    return realpathSync(absPath)
  } catch {
    return absPath // fichero ya borrado: la clave cruda basta para expirar
  }
}

function pruneExpired(now: number): void {
  const map = store()
  for (const [k, e] of map) {
    if (now - e.at > TTL_MS) map.delete(k)
  }
}

/** La app declara una escritura: path + hash del contenido escrito. */
export function markOwnWrite(absPath: string, hash: string): void {
  const now = Date.now()
  pruneExpired(now)
  store().set(key(absPath), { hash, at: now })
}

/**
 * Consulta (sin consumir): hash registrado para ese path, o null si no hay
 * registro o expiró por TTL. NO se borra al leer: chokidar emite típicamente
 * add+change para la misma escritura, y ambos deben reconocerse como propios.
 * La entrada caduca sola por TTL.
 */
export function peekOwnWrite(absPath: string): string | null {
  const map = store()
  const entry = map.get(key(absPath))
  if (!entry) return null
  if (Date.now() - entry.at > TTL_MS) {
    map.delete(key(absPath))
    return null
  }
  return entry.hash
}
