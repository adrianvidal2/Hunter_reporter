import { rmSync } from 'node:fs'
import { defaultDbPath, openDb } from './db'

/**
 * `pnpm db:reset`: borra el índice y lo recrea desde cero aplicando las
 * migraciones. El índice es reconstruible por diseño: la verdad sigue
 * estando en el sistema de ficheros (basta un `reindex()` después).
 */
const dbPath = defaultDbPath()
for (const suffix of ['', '-wal', '-shm']) {
  rmSync(dbPath + suffix, { force: true })
}

const db = openDb(dbPath)
db.$client.close()
console.log(`Índice recreado en ${dbPath} (migraciones aplicadas)`)
