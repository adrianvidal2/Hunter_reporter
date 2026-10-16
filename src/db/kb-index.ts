import { getEnv } from '../lib/env'
import { listProjects } from '../core/fs/tree'
import { listKbIndex, loadKbEntry, type KbCategory } from '../core/kb/kb'
import { defaultDbPath, openDb } from './db'

/**
 * Recuperación de la KB con FTS5/BM25 sobre el `reporter.db` (Tarea 6e).
 * Léxico-primero: sub-ms, sin modelo, sin datos fuera del disco
 * (decisión en docs/kb-retrieval-study.md; vectores/GraphRAG = fase futura).
 *
 * - La tabla virtual `kb_fts` (migración 0005) es un ÍNDICE RECONSTRUIBLE:
 *   `rebuildKbIndex()` la vacía y repuebla desde el markdown de la KB — el
 *   disco es la verdad, igual que `reindex()` con projects/files.
 * - Chunks pequeños (~350 chars, por párrafos): rinden mejor en BM25.
 * - La búsqueda soporta la sintaxis FTS5 (AND/OR/NOT, prefijos `term*`).
 *   Una query con sintaxis rota NO revienta: se reintenta como términos
 *   literales entrecomillados (frase exacta AND).
 * - El filtro `project` limita a global + ESE proyecto (aislamiento por
 *   ámbito, coherente con el resto de la app).
 *
 * Nota: indexar `findings` aquí queda como extensión futura (la tarea la
 * marca opcional); hoy el índice cubre solo la KB.
 */

/** Tope de tamaño de chunk en caracteres (estudio: ~300–400). */
const CHUNK_SIZE = 350

export interface KbSearchHit {
  slug: string
  scope: 'global' | 'project'
  /** Nombre del proyecto cuando scope='project'. */
  project?: string
  category: KbCategory
  title: string
  description: string
  /** Ranking BM25 (más negativo = mejor match, criterio FTS5). */
  rank: number
}

/** Parte un cuerpo en chunks pequeños: por párrafos, con corte duro de los enormes. */
export function chunkBody(body: string, size: number = CHUNK_SIZE): string[] {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
  const chunks: string[] = []
  let current = ''
  const push = () => {
    if (current !== '') chunks.push(current)
    current = ''
  }
  for (const p of paragraphs) {
    // párrafo individual mayor que el tope: corte duro en trozos de `size`
    if (p.length > size) {
      push()
      for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size))
      continue
    }
    if (current === '') current = p
    else if (current.length + p.length + 2 <= size) current += `\n\n${p}`
    else {
      push()
      current = p
    }
  }
  push()
  return chunks
}

interface IndexedEntry {
  slug: string
  scopeName: string // 'global' o nombre del proyecto
  category: KbCategory
  title: string
  description: string
  body: string
}

/** Entradas de TODOS los ámbitos (el FS es la verdad): global + cada proyecto. */
function collectEntries(root: string): IndexedEntry[] {
  const out: IndexedEntry[] = []
  for (const e of listKbIndex({ root })) {
    const full = loadKbEntry(e.slug, { root })
    out.push({ slug: full.slug, scopeName: 'global', category: full.category, title: full.name, description: full.description, body: full.body })
  }
  for (const project of listProjects(root)) {
    for (const e of listKbIndex({ project, root })) {
      if (e.scope !== 'project') continue // la global ya está indexada
      const full = loadKbEntry(e.slug, { project, root })
      out.push({ slug: full.slug, scopeName: project, category: full.category, title: full.name, description: full.description, body: full.body })
    }
  }
  return out
}

/**
 * Reconstrucción COMPLETA del índice FTS desde el markdown de la KB
 * (borrar y repoblar: el índice nunca es fuente de verdad).
 */
export function rebuildKbIndex(root: string = getEnv().REPORTS_ROOT, dbPath: string = defaultDbPath()): { entries: number; chunks: number } {
  const entries = collectEntries(root)
  const db = openDb(dbPath)
  try {
    const chunks = db.$client.transaction(() => {
      db.$client.prepare('DELETE FROM kb_fts').run()
      const insert = db.$client.prepare(
        'INSERT INTO kb_fts (slug, scope, category, title, description, text) VALUES (?, ?, ?, ?, ?, ?)',
      )
      let n = 0
      for (const e of entries) {
        const parts = chunkBody(e.body)
        if (parts.length === 0) {
          // sin cuerpo: la fila con title+description sigue siendo buscable
          insert.run(e.slug, e.scopeName, e.category, e.title, e.description, '')
          n++
          continue
        }
        for (const part of parts) {
          insert.run(e.slug, e.scopeName, e.category, e.title, e.description, part)
          n++
        }
      }
      return n
    })()
    return { entries: entries.length, chunks }
  } finally {
    db.$client.close()
  }
}

/** Términos como frases literales entrecomilladas (fallback anti-sintaxis). */
function toLiteralQuery(raw: string): string {
  return raw
    .split(/\s+/)
    .filter((w) => w !== '')
    .map((w) => `"${w.replaceAll('"', '""')}"`)
    .join(' ')
}

export interface SearchKbOptions {
  /** Filtra por categoría del índice (tecnica | reporte). */
  category?: KbCategory
  /** Limita a global + ESTE proyecto (aislamiento de ámbitos). */
  project?: string
  limit?: number
  root?: string
  dbPath?: string
}

/**
 * Búsqueda BM25 sobre el índice. Sintaxis FTS5 soportada (AND/OR/NOT,
 * prefijos `term*`); con sintaxis rota reintenta como literales. Query
 * vacía o sin resultados → [] sin romper. Un resultado por entrada
 * (aunque salga en varios chunks), el mejor chunk manda.
 */
export function searchKb(query: string, opts: SearchKbOptions = {}): KbSearchHit[] {
  const q = query.trim()
  if (q === '') return []
  const limit = Math.max(1, opts.limit ?? 10)

  const scopes = opts.project ? ['global', opts.project] : ['global']
  const filters = [`scope IN (${scopes.map(() => '?').join(', ')})`]
  const params: (string | number)[] = [...scopes]
  if (opts.category) {
    filters.push('category = ?')
    params.push(opts.category)
  }
  const where = `kb_fts MATCH ? AND ${filters.join(' AND ')}`
  const sql =
    `SELECT slug, scope, category, title, description, bm25(kb_fts, 0.0, 0.0, 0.0, 5.0, 3.0, 1.0) AS rank ` +
    `FROM kb_fts WHERE ${where}`
  const finalParams = (match: string): (string | number)[] => [match, ...params]

  const db = openDb(opts.dbPath ?? defaultDbPath())
  try {
    let rows: { slug: string; scope: string; category: string; title: string; description: string; rank: number }[]
    try {
      rows = db.$client.prepare(sql).all(...finalParams(q)) as typeof rows
    } catch {
      // sintaxis FTS5 inválida (operadores sueltos, paréntesis, comillas…):
      // reintento como términos literales — jamás una excepción al consumidor
      rows = db.$client.prepare(sql).all(...finalParams(toLiteralQuery(q))) as typeof rows
    }
    // dedup en JS (bm25 no puede ir dentro de un GROUP BY): el mejor chunk
    // de cada entrada manda; después orden y límite
    const best = new Map<string, { slug: string; scope: string; category: string; title: string; description: string; rank: number }>()
    for (const r of rows) {
      const key = `${r.scope}\u0000${r.slug}`
      const current = best.get(key)
      if (!current || r.rank < current.rank) best.set(key, r)
    }
    return [...best.values()]
      .sort((a, b) => a.rank - b.rank)
      .slice(0, limit)
      .map((r) => ({
        slug: r.slug,
        scope: r.scope === 'global' ? 'global' : 'project',
        project: r.scope === 'global' ? undefined : r.scope,
        category: r.category as KbCategory,
        title: r.title,
        description: r.description,
        rank: r.rank,
      }))
  } finally {
    db.$client.close()
  }
}
