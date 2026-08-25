import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

/**
 * Apertura del índice SQLite (bloque 2).
 *
 * - `openDb` aplica las migraciones pendientes (idempotente) al abrir.
 * - La ruta por defecto es `reporter.db` en la raíz de la app; los tests
 *   inyectan rutas en tmpdir.
 * - WAL para rendimiento de escritura: el índice se repuebla entero.
 */

export function defaultDbPath(): string {
  return process.env.DB_PATH ?? path.join(process.cwd(), 'reporter.db')
}

/** Carpeta de migraciones: junto a este fichero en src/ (tsx/vitest) o
 *  vía cwd (Next/Turbopack empaqueta y `import.meta.url` no basta). */
function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.join(here, 'migrations'),
    path.join(process.cwd(), 'src', 'db', 'migrations'),
  ]
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!
}

/** Base de datos drizzle sobre better-sqlite3 (con `$client` para cerrar). */
export type Db = ReturnType<typeof openDb>

export function openDb(dbPath: string = defaultDbPath()) {
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: migrationsFolder() })
  return db
}
