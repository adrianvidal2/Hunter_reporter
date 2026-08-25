import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/** sha-256 (hex) del contenido de un fichero. Índice, watcher y pending. */
export function sha256File(absPath: string): string {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex')
}
