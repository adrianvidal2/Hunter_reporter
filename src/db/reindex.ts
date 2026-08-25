import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { defaultDbPath, openDb } from './db'
import { files, projects } from './schema'
import { listProject, listProjects } from '../core/fs/tree'
import { resolveSafe } from '../core/fs/paths'
import { getEnv } from '../lib/env'

/**
 * `reindex()` (paso 2.2): repuebla el índice desde el sistema de ficheros.
 *
 * Estrategia simple y robusta: TODO en una transacción — borra projects
 * (cascada a files) y reinserta desde cero leyendo el árbol con
 * listProjects/listProject (la misma fuente de verdad que la UI).
 *
 * El hash (sha256) exige leer cada fichero: aceptable para el tamaño de un
 * árbol local de reportes; permite detectar cambios de contenido con el
 * mismo path (lo necesitará el watcher del bloque 6).
 */

export interface ReindexResult {
  projects: number
  files: number
  pdfs: number
  mds: number
}

export function reindex(
  root: string = getEnv().REPORTS_ROOT,
  dbPath: string = defaultDbPath(),
): ReindexResult {
  const db = openDb(dbPath)
  try {
    return db.transaction((tx) => {
      tx.delete(projects).run() // cascade ⇒ files también

      const projectNames = listProjects(root)
      let pdfs = 0
      let mds = 0
      const fileRows: (typeof files.$inferInsert)[] = []

      for (const name of projectNames) {
        tx.insert(projects).values({ name }).run()
        const listing = listProject(name, root)

        for (const f of listing.delivered) {
          fileRows.push(rowFor(name, f.relPath, 'pdf', root))
          pdfs++
        }
        for (const f of listing.drafts) {
          fileRows.push(rowFor(name, f.relPath, 'md', root))
          mds++
        }
      }

      if (fileRows.length > 0) tx.insert(files).values(fileRows).run()

      return { projects: projectNames.length, files: fileRows.length, pdfs, mds }
    })
  } finally {
    db.$client.close()
  }
}

function rowFor(
  project: string,
  relPath: string,
  kind: 'pdf' | 'md',
  root: string,
): typeof files.$inferInsert {
  const absPath = resolveSafe(relPath, root)
  const content = readFileSync(absPath)
  return {
    path: relPath,
    project,
    hash: createHash('sha256').update(content).digest('hex'),
    size: content.length,
    mtimeMs: Math.round(statSync(absPath).mtimeMs),
    kind,
  }
}
