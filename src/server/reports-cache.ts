import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from '@/lib/env'
import { writeAtomic } from '@/core/fs/atomic'
import { resolveSafeAllowMissing } from '@/core/fs/paths'
import type { UserReport } from '@/core/ywh/reports'

/**
 * Cache a disco de "mis reportes" de YesWeHack.
 *
 * - Fichero: `<root>/.config/reports-cache.json` (carpeta oculta, a salvo de
 *   la vista de proyectos). Contiene datos PRIVADOS de tus reportes → en
 *   .gitignore y fuera del repo.
 * - La ventana PINTA SIEMPRE desde esta cache; "Actualizar" hace la llamada
 *   en vivo y reescribe la cache.
 * - Si una llamada falla (token caducado, red, 404 del gateway que en
 *   realidad es sesión muerta) NO se borra la cache: se conserva lo último.
 */

export const REPORTS_CACHE_FILE = '.config/reports-cache.json'

export interface ReportsCache {
  savedAt: number
  items: UserReport[]
}

/** Ruta absoluta del fichero de cache (resolución segura). */
export function reportsCachePath(root: string = getEnv().REPORTS_ROOT): string {
  return resolveSafeAllowMissing(REPORTS_CACHE_FILE, root)
}

/** Lee la cache; null si no existe o está corrupta. */
export function readReportsCache(root: string = getEnv().REPORTS_ROOT): ReportsCache | null {
  try {
    const abs = reportsCachePath(root)
    if (!existsSync(abs)) return null
    const raw = JSON.parse(readFileSync(abs, 'utf8')) as ReportsCache
    if (typeof raw?.savedAt !== 'number' || !Array.isArray(raw?.items)) return null
    return raw
  } catch {
    return null
  }
}

/** Escribe la cache (atómico). */
export function writeReportsCache(
  items: UserReport[],
  root: string = getEnv().REPORTS_ROOT,
  savedAt: number = Date.now(),
): void {
  mkdirSync(path.join(root, '.config'), { recursive: true })
  writeAtomic(REPORTS_CACHE_FILE, JSON.stringify({ savedAt, items }, null, 2), { root })
}

/** Fragilidad: antigüedad en ms desde `savedAt` (0 si no hay cache). */
export function cacheAgeMs(cache: ReportsCache | null, now: number = Date.now()): number {
  return cache ? Math.max(0, now - cache.savedAt) : 0
}
