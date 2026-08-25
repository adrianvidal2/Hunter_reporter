import chokidar from 'chokidar'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { sha256File } from './hash'

/**
 * Watcher del árbol de reportes (paso 6.1).
 *
 * - `awaitWriteFinish`: no emite hasta que el fichero deja de crecer
 *   (un `cp` grande produce UN evento, no una ráfaga).
 * - Ignora `.trash`, `.history`, `.cache` y ficheros `.tmp` (los que escribe
 *   writeAtomic viven en el mismo directorio y desaparecen al rename).
 * - Módulo puro sin Next ni BD: quien lo usa decide qué hacer con los
 *   eventos (en 6.2, alta idempotente en pending_actions).
 */

export interface WatchEvent {
  type: 'add' | 'change' | 'unlink'
  /** Ruta relativa a REPORTS_ROOT con separadores '/'. */
  relPath: string
  absPath: string
  /** sha-256 del contenido (ausente en unlink). */
  hash?: string
}

/** Artefactos que jamás son reportes: papelera, historial, caché,
 *  configuración/plantillas (.config), temporales de writeAtomic y ficheros
 *  SQLite del índice (aunque alguien coloque la BD dentro del árbol). */
const IGNORED_DIRS = new Set(['.trash', '.history', '.cache', '.config'])
const IGNORED_SUFFIX = /\.(db|db-wal|db-shm|tmp)$/

/**
 * Política de vigilancia (aclaración del usuario, bloque 9):
 * un proyecto puede tener MÁS subdirectorios que REPORTES_YWH/ y reportes/
 * (notas, capturas, scripts, recon…). La app SOLO vigila ficheros dentro de
 * <proyecto>/reportes/ y de _inbox/. Todo lo demás se ignora por completo:
 * sin eventos, sin avisos, sin errores.
 *
 * Nota chokidar: `ignored(path, stats)` se llama por CADA directorio del
 * árbol; los DIRECTORIOS no vigilados se dejan explorar (para poder llegar
 * a reportes/ dentro de un proyecto), y solo se ignoran FICHEROS fuera de
 * las carpetas vigiladas + directorios sabidamente irrelevantes (.trash…).
 */
const WATCHED_DIRS = new Set(['reportes', '_inbox'])

function isIgnoredDir(absPath: string): boolean {
  const segments = absPath.replaceAll('\\', '/').split('/')
  const name = segments.at(-1) ?? ''
  // carpetas sabidamente irrelevantes: ni explorarlas
  if (IGNORED_DIRS.has(name) || name === 'REPORTES_YWH' || name === 'node_modules') return true
  // _inbox se explora; cualquier otro directorio se explora para llegar a
  // los reportes/ anidados
  return false
}

function isIgnoredFile(absPath: string, realRoot: string): boolean {
  if (IGNORED_SUFFIX.test(absPath)) return true
  // Filtrar por segmentos RELATIVOS al root: si el propio root se llama
  // "reportes" (caso real del usuario), su nombre NO debe desactivar el
  // filtro para todo el árbol.
  const rel = path.relative(realRoot, absPath)
  const segments = rel.replaceAll('\\', '/').split('/')
  if (segments.some((s) => IGNORED_DIRS.has(s))) return true
  // aclaración bloque 9: solo ficheros bajo <algo>/reportes/ o _inbox/
  return !segments.some((s) => WATCHED_DIRS.has(s))
}

interface PathStats {
  isFile?: () => boolean | undefined
  isDirectory?: () => boolean | undefined
}

function isIgnoredPath(absPath: string, realRoot: string, stats?: PathStats): boolean {
  if (stats?.isFile?.()) return isIgnoredFile(absPath, realRoot)
  if (stats?.isDirectory?.()) return isIgnoredDir(absPath)
  // sin stats (p. ej. la primera llamada sobre el root): dejar pasar —
  // los ficheros no vigilados se filtran igualmente al llegar con stats.
  return false
}

export interface Watcher {
  /** Se resuelve cuando el árbol inicial está escaneado (listo para eventos). */
  ready: Promise<void>
  close(): Promise<void>
}

export function createWatcher(root: string, onEvent: (event: WatchEvent) => void): Watcher {
  const realRoot = realpathSync(root)
  const relOf = (abs: string) =>
    path.relative(realRoot, abs).split(path.sep).join('/')

  const watcher = chokidar.watch(realRoot, {
    ignoreInitial: true, // solo ficheros NUEVOS o cambiados, no el árbol entero
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    ignored: (p: string, stats?: PathStats) => isIgnoredPath(p, realRoot, stats),
  })

  const ready = new Promise<void>((resolve) => watcher.on('ready', () => resolve()))

  const emit = (type: WatchEvent['type'], absPath: string) => {
    // filtrado de EMISIÓN (sin stats disponible aquí): reglas de fichero
    if (isIgnoredFile(absPath, realRoot)) return
    const event: WatchEvent = { type, relPath: relOf(absPath), absPath }
    if (type !== 'unlink') event.hash = sha256File(absPath)
    onEvent(event)
  }

  watcher.on('add', (absPath) => emit('add', absPath))
  watcher.on('change', (absPath) => emit('change', absPath))
  watcher.on('unlink', (absPath) => emit('unlink', absPath))

  return { ready, close: () => watcher.close() }
}
