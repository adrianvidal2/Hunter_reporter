import { createWatcher, type WatchEvent } from '@/core/fs/watcher'
import { defaultDbPath } from '@/db/db'
import { listPending, registerPendingFile } from '@/db/pending'
import { getEnv } from '@/lib/env'

/**
 * Servicio watcher→BD→SSE (paso 6.3), SINGLETON por root.
 *
 * En dev con hot reload los módulos se re-evalúan: una instancia guardada
 * solo en el módulo acabaría duplicada (dos chokidar, eventos dobles). La
 * instancia vive en `globalThis`, claveada por root, y además se arranca en
 * instrumentation.ts (una vez por proceso servidor). Cualquier número de
 * conexiones SSE solo añade suscriptores A LA MISMA instancia.
 *
 * Cada evento de fichero pasa por registerPendingFile (alta idempotente,
 * 6.2) y después se reemite el contador a los suscriptores.
 */

export type SsePayload =
  | { type: 'count'; count: number }
  | { type: 'pending'; path: string; outcome: 'inserted' | 'updated' | 'noop' }

export interface WatcherService {
  /** Suscribe; emite inmediatamente el contador actual. Deviene unsubscribe. */
  subscribe(cb: (payload: SsePayload) => void): () => void
  /** Se resuelve cuando chokidar terminó el escaneo inicial. */
  ready: Promise<void>
  /** Reemite el contador a los suscriptores (para las Server Actions). */
  readonly broadcastCount: () => void
  close(): Promise<void>
}

const globalStore = globalThis as typeof globalThis & {
  __reporterWatcherServices?: Map<string, WatcherService>
}

export function getWatcherService(
  root: string = getEnv().REPORTS_ROOT,
  dbPath: string = defaultDbPath(),
): WatcherService {
  const store = (globalStore.__reporterWatcherServices ??= new Map())
  const existing = store.get(root)
  if (existing) return existing
  const service = createService(root, dbPath, () => store.delete(root))
  store.set(root, service)
  return service
}

/** Solo para tests/apagado: cierra y desregistrar el servicio de un root. */
export async function closeWatcherService(root: string): Promise<void> {
  const store = globalStore.__reporterWatcherServices
  const service = store?.get(root)
  if (store && service) {
    store.delete(root)
    await service.close()
  }
}

/**
 * Reemite el contador de pendientes a los suscriptores, SOLO si el servicio
 * ya existe (lo crea quien lo necesite de verdad: instrumentation/SSE).
 * Permite a las Server Actions refrescar el badge sin arrancar watchers
 * adventicios en procesos que no lo tienen (p. ej. los tests).
 */
export function notifyPendingCount(root: string = getEnv().REPORTS_ROOT): void {
  globalStore.__reporterWatcherServices?.get(root)?.broadcastCount()
}

function createService(
  root: string,
  dbPath: string,
  onClose: () => void,
): WatcherService {
  const subscribers = new Set<(payload: SsePayload) => void>()

  const broadcast = (payload: SsePayload) => {
    for (const cb of subscribers) cb(payload)
  }
  const broadcastCount = () => broadcast({ type: 'count', count: listPending(dbPath).length })

  const onEvent = (event: WatchEvent) => {
    if (event.type === 'unlink') return // 6.5 decide qué hacer con borrados
    const outcome = registerPendingFile(event.absPath, root, dbPath)
    broadcast({ type: 'pending', path: event.relPath, outcome })
    broadcastCount()
  }

  const watcher = createWatcher(root, onEvent)

  return {
    ready: watcher.ready,
    get broadcastCount() {
      return broadcastCount
    },
    subscribe(cb) {
      subscribers.add(cb)
      cb({ type: 'count', count: listPending(dbPath).length })
      return () => subscribers.delete(cb)
    },
    async close() {
      subscribers.clear()
      await watcher.close()
      onClose()
    },
  }
}
