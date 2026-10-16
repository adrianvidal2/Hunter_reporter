import type { KbIndexEntry } from './kb'

/**
 * Facetado de la KB (Tarea 11): el primer escalón barato de la "vista por
 * grafos" — agrupar entradas por **tag** o por **categoría** ("XSS → estas
 * entradas"). SIN grafo dibujado, SIN LLM, SIN infra: puro reagrupado sobre
 * el índice que `listKbIndex` ya devuelve (category + tags).
 *
 * - Una entrada con VARIOS tags aparece en VARIOS grupos (es un faceto, no
 *   una partición).
 * - En `tag`, las entradas sin tags van al grupo especial "(sin etiqueta)".
 * - Orden estable: alfabético por clave (locale es, numérico).
 */

export type KbFacet = 'tag' | 'category'

export interface KbGroup {
  key: string
  entries: KbIndexEntry[]
}

/** Clave del grupo especial para entradas sin tags en el facetado por tag. */
export const UNTAGGED_KEY = '(sin etiqueta)'

export function groupKbEntries(
  entries: KbIndexEntry[],
  opts: { by: KbFacet },
): KbGroup[] {
  const groups = new Map<string, KbIndexEntry[]>()

  for (const entry of entries) {
    const keys =
      opts.by === 'category'
        ? [entry.category]
        : entry.tags.length > 0
          ? entry.tags
          : [UNTAGGED_KEY]
    for (const key of keys) {
      const list = groups.get(key)
      if (list) list.push(entry)
      else groups.set(key, [entry])
    }
  }

  return [...groups.entries()]
    .map(([key, groupEntries]) => ({ key, entries: groupEntries }))
    .sort((a, b) => a.key.localeCompare(b.key, 'es', { numeric: true, sensitivity: 'base' }))
}
