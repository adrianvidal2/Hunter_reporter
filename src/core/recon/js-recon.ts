/**
 * Recolección y reconstrucción de JS (Tarea 7a). Núcleo PURO: parseo de
 * sourcemaps, detección de `sourceMappingURL` y modelo de cobertura. Sin
 * I/O: el fetch y la persistencia viven en `server/js-harvest.ts`.
 *
 * Principio del epic 7 (no se negocia): A es FIABLE donde el dato existe.
 * Un sourcemap con `sourcesContent` → fuentes reconstruidas EXACTAS (es la
 * especificación). Sin map NO se "des-minifica" nada aquí: se marca el
 * hueco para que el agente (07d/07e) decida qué hacer con él.
 */

import { z } from 'zod'
import { sanitizeFilename } from '../fs/sanitize'

/** Tamaño máximo de JS/mapa que el harvest leerá (los enormes se marcan). */
export const MAX_JS_BYTES = 5 * 1024 * 1024
export const MAX_MAP_BYTES = 2 * 1024 * 1024

/** Dónde está el sourcemap de un JS: inline (data URI) o remoto. */
export type MapSource =
  | { kind: 'inline'; json: string }
  | { kind: 'remote'; url: string }

/**
 * Detecta el `sourceMappingURL` de un JS (también el legado `//@`) y lo
 * resuelve: data URI → JSON decodificado; relativa → URL absoluta contra el
 * JS. La ÚLTIMA declaración manda (así lo dice la especificación).
 * Sin declaración o data URI rota → null (hueco 'no-map').
 */
export function resolveSourceMapping(jsUrl: string, jsBody: string): MapSource | null {
  const matches = [...jsBody.matchAll(/\/\/[#@]\s*sourceMappingURL=([^\s'"]+)/g)]
  const last = matches.at(-1)?.[1]
  if (!last) return null

  if (last.startsWith('data:')) {
    const comma = last.indexOf(',')
    if (comma < 0) return null
    const meta = last.slice(5, comma)
    const payload = last.slice(comma + 1)
    try {
      const json = /;base64/i.test(meta)
        ? Buffer.from(payload, 'base64').toString('utf8')
        : decodeURIComponent(payload)
      if (json.trim() === '') return null // payload inservible (base64 permisivo)
      return { kind: 'inline', json }
    } catch {
      return null
    }
  }

  try {
    return { kind: 'remote', url: new URL(last, jsUrl).toString() }
  } catch {
    return null
  }
}

/**
 * Parseo TOLERANTE de un sourcemap v3: `sources` (strings) es obligatorio;
 * `sourcesContent` opcional y alineado por índice (lo que falte o no sea
 * string → null = hueco). JSON roto o sin sources utilizables → null.
 */
export function parseSourcemap(raw: string): { sources: string[]; sourcesContent: (string | null)[] } | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = z
    .object({
      sources: z.array(z.unknown()),
      sourcesContent: z.array(z.unknown()).nullish().catch(undefined),
    })
    .safeParse(json)
  if (!parsed.success) return null

  const sources = parsed.data.sources
    .filter((s): s is string => typeof s === 'string')
  if (sources.length === 0) return null

  const content = parsed.data.sourcesContent
  const sourcesContent = sources.map((_, i) => {
    const v = Array.isArray(content) ? content[i] : undefined
    return typeof v === 'string' ? v : null
  })
  return { sources, sourcesContent }
}

export interface JsSourceFile {
  /** Ruta tal cual la declara el map (trazabilidad). */
  sourcePath: string
  /** Ruta relativa SEGURA para volcar (aplanada, sanitizada, sin '..'). */
  fileName: string
  /** Contenido reconstruido; null = el map no trae sourcesContent (hueco). */
  content: string | null
}

export interface SourcemapReconstruction {
  files: JsSourceFile[]
  /** Fuentes con contenido reconstruido. */
  withContent: number
  /** Fuentes declaradas SIN contenido (hueco honesto). */
  withoutContent: number
}

/**
 * Reconstrucción desde el map crudo: una fila por fuente declarada, con su
 * contenido EXACTO cuando `sourcesContent` lo trae. null si el map no es
 * utilizable (hueco 'map-invalid').
 */
export function reconstructFromSourcemap(mapRaw: string): SourcemapReconstruction | null {
  const parsed = parseSourcemap(mapRaw)
  if (!parsed) return null
  const files: JsSourceFile[] = parsed.sources.map((sourcePath, i) => ({
    sourcePath,
    fileName: safeSourceFileName(sourcePath) ?? `source-${i + 1}.txt`,
    content: parsed.sourcesContent[i],
  }))
  const withContent = files.filter((f) => f.content !== null).length
  return { files, withContent, withoutContent: files.length - withContent }
}

/**
 * Ruta de disco SEGURA para una source del map: sin esquemas (webpack://,
 * file://), sin unidad Windows, sin '', '.' ni '..'; cada segmento pasa por
 * sanitizeFilename; máximo 3 segmentos finales. null si no queda nada
 * utilizable. La contención FINAL la garantiza resolveSafe* al escribir.
 */
export function safeSourceFileName(sourcePath: string): string | null {
  if (typeof sourcePath !== 'string' || sourcePath.trim() === '') return null
  const withoutScheme = sourcePath.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const withoutRoot = withoutScheme.replace(/^[/\\]+/, '').replace(/^[a-z]:/i, '')
  const segments = withoutRoot
    .split(/[\\/]/)
    .filter((s) => s !== '' && s !== '.' && s !== '..')
    .map((s) => {
      try {
        return sanitizeFilename(s)
      } catch {
        return ''
      }
    })
    .filter((s) => s !== '')
  if (segments.length === 0) return null
  return segments.slice(-3).join('/')
}

// ── Cobertura (transparencia: qué se sacó y qué no) ─────────────────────

export type JsHarvestStatus =
  | 'reconstructed'
  | 'no-map'
  | 'map-invalid'
  | 'map-without-content'
  | 'map-fetch-error'
  | 'fetch-error'
  | 'skipped-large'
  | 'out-of-scope'

export interface JsCoverageEntry {
  url: string
  status: JsHarvestStatus
  jsBytes?: number
  mapUrl?: string
  /** Fuentes declaradas en el map (cuando lo hay). */
  sources?: number
  /** Fuentes reconstruidas con contenido exacto. */
  reconstructed?: number
  /** Ficheros escritos en disco para esta URL. */
  filesWritten?: number
  error?: string
}

export interface JsHarvestStats {
  js: number
  withMap: number
  reconstructed: number
  gaps: number
}

/** Resumen honesto de la cobertura (para coverage.json y la UI). */
export function summarizeCoverage(entries: JsCoverageEntry[]): JsHarvestStats {
  return {
    js: entries.filter((e) => e.status !== 'out-of-scope').length,
    withMap: entries.filter((e) => !['no-map', 'out-of-scope', 'fetch-error', 'skipped-large'].includes(e.status)).length,
    reconstructed: entries.filter((e) => e.status === 'reconstructed').length,
    gaps: entries.filter((e) => e.status !== 'reconstructed' && e.status !== 'out-of-scope').length,
  }
}
