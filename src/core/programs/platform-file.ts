import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { writeAtomic } from '../fs/atomic'
import { getEnv } from '../../lib/env'
import type { PlatformId } from './types'

/**
 * `platform.json` sidecar en `<proyecto>/.config/platform.json` (paso 4
 * revisado): marca a qué plataforma pertenece el proyecto. Va en `.config/`
 * por coherencia con `.config/templates/` y porque `.config` está en los
 * ignorados del watcher desde 7.1: garantizado que nunca genera eventos.
 *
 * COMPATIBILIDAD: el paso 4 original lo escribía en la RAÍZ del proyecto.
 * La lectura es retrocompatible: si solo existe el de la raíz, se lee, se
 * migra a `.config/` en el mismo paso y el de la raíz se borra.
 *
 * Los proyectos creados desde la app lo escriben al crearse; los
 * anteriores se migran con `pnpm migrate:platform` (seco por defecto).
 */

const PLATFORMS: PlatformId[] = ['yeswehack', 'intigriti']

export interface PlatformJson {
  platform: PlatformId
  /** YWH: slug del programa. */
  slug?: string
  /** Intigriti: uuid del programa y su handle. */
  programId?: string
  handle?: string
  /** Cuándo se escribió/migró la marca. */
  updatedAt: string
  /** true si lo escribió el script de migración (no ha habido fetch). */
  migrated?: boolean
}

/** Ruta actual: `<proyecto>/.config/platform.json`. */
export function projectPlatformPath(project: string, root: string = getEnv().REPORTS_ROOT): string {
  return `${project}/.config/platform.json`
}

/** Ruta LEGACY (paso 4 original): `<proyecto>/platform.json` en la raíz. */
export function legacyProjectPlatformPath(project: string, root: string = getEnv().REPORTS_ROOT): string {
  return `${project}/platform.json`
}

/** Escribe (o actualiza) `.config/platform.json` de un proyecto. Atómico. */
export function writePlatformJson(
  project: string,
  data: Omit<PlatformJson, 'updatedAt'> & { updatedAt?: string },
  root: string = getEnv().REPORTS_ROOT,
): string {
  if (!PLATFORMS.includes(data.platform)) {
    throw new Error(`Plataforma desconocida: ${String(data.platform)}`)
  }
  const rel = projectPlatformPath(project, root)
  // el proyecto/.config puede no existir aún (p. ej. migraciones)
  mkdirSync(`${root}/${project}/.config`, { recursive: true })
  const payload: PlatformJson = { ...data, updatedAt: data.updatedAt ?? new Date().toISOString() }
  writeAtomic(rel, JSON.stringify(payload, null, 2) + '\n', { root })
  return rel
}

/**
 * Lee y valida `platform.json`; null si falta, está corrupto o es de otra
 * plataforma. LECTURA RETROCOMPATIBLE: si el válido está en la raíz (formato
 * antiguo), se migra a `.config/` en el mismo paso y el de la raíz se borra.
 */
export function readPlatformJson(project: string, root: string = getEnv().REPORTS_ROOT): PlatformJson | null {
  const parse = (): PlatformJson | null | 'invalid' => {
    try {
      const raw = JSON.parse(readFileSync(`${root}/${projectPlatformPath(project, root)}`, 'utf8')) as {
        platform?: unknown
      }
      if (typeof raw.platform !== 'string' || !PLATFORMS.includes(raw.platform as PlatformId)) return 'invalid'
      return raw as PlatformJson
    } catch {
      return null
    }
  }

  const current = parse()
  if (current !== null) return current === 'invalid' ? null : current

  // ¿legacy en la raíz? → leer, migrar a .config/ y borrar el de la raíz
  const legacyRel = legacyProjectPlatformPath(project, root)
  if (!existsSync(`${root}/${legacyRel}`)) return null
  try {
    const raw = JSON.parse(readFileSync(`${root}/${legacyRel}`, 'utf8')) as { platform?: unknown }
    if (typeof raw.platform !== 'string' || !PLATFORMS.includes(raw.platform as PlatformId)) return null
    writePlatformJson(project, raw as PlatformJson, root)
    rmSync(`${root}/${legacyRel}`)
    return raw as PlatformJson
  } catch {
    return null
  }
}
