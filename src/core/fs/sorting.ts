import type { FileEntry } from './tree'

/**
 * Orden y búsqueda de ficheros (paso 3.3). Funciones puras sobre los
 * FileEntry de listProject: la UI las aplica en cliente (pocos ficheros,
 * respuesta inmediata) y quedan testeadas aquí en el núcleo.
 */

export type SortBy = 'name' | 'date' | 'size'
export type SortDir = 'asc' | 'desc'

/** Orden natural: `informe2` antes que `informe10` (numérico, no léxico). */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' })
}

/** Copia ordenada (no muta el array de entrada). Empate → desempate por nombre. */
export function sortFiles(files: FileEntry[], by: SortBy, dir: SortDir): FileEntry[] {
  return [...files].sort((x, y) => {
    let r: number
    if (by === 'name') r = naturalCompare(x.name, y.name)
    else if (by === 'date') r = x.mtimeMs - y.mtimeMs
    else r = x.size - y.size
    if (r === 0) r = naturalCompare(x.name, y.name)
    return dir === 'asc' ? r : -r
  })
}

/** Filtrado por nombre, insensible a mayúsculas y alrededores de espacios. */
export function filterFiles(files: FileEntry[], query: string): FileEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return files
  return files.filter((f) => f.name.toLowerCase().includes(q))
}
