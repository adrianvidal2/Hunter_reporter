import { createHash } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFixture } from '../test/fixtures/fixture'
import { writeAtomic } from '../core/fs/atomic'
import { openDb } from './db'
import { reindex } from './reindex'
import { files, projects } from './schema'

describe('reindex', () => {
  it('conteos exactos sobre el fixture y filas correctas (hash incluido)', () => {
    const fx = createFixture()
    try {
      const dbPath = path.join(fx.root, 'index.db')
      const res = reindex(fx.root, dbPath)
      expect(res).toEqual({ projects: 1, files: 3, pdfs: 1, mds: 2 })

      const db = openDb(dbPath)
      try {
        expect(db.select({ name: projects.name }).from(projects).all()).toEqual([
          { name: 'demo_project' },
        ])

        const rows = db.select().from(files).all()
        expect(rows.map((r) => r.path).sort()).toEqual([
          'demo_project/REPORTES_YWH/informe-xss-reflejado.pdf',
          'demo_project/reportes/borrador-sqli.md',
          'demo_project/reportes/informe-idor.md',
        ])

        const byPath = Object.fromEntries(rows.map((r) => [r.path, r]))
        expect(byPath['demo_project/REPORTES_YWH/informe-xss-reflejado.pdf']!.kind).toBe('pdf')
        expect(byPath['demo_project/reportes/informe-idor.md']!.kind).toBe('md')

        const idor = byPath['demo_project/reportes/informe-idor.md']!
        const expectedHash = createHash('sha256')
          .update(readFileSync(fx.mdFrontMatter))
          .digest('hex')
        expect(idor.hash).toBe(expectedHash)
        expect(idor.size).toBe(readFileSync(fx.mdFrontMatter).length)
        expect(idor.mtimeMs).toBeGreaterThan(0)
      } finally {
        db.$client.close()
      }
    } finally {
      fx.cleanup()
    }
  })

  it('reindex dos veces deja el mismo estado (sin duplicados ni restos)', () => {
    const fx = createFixture({ extraProjects: ['banco_demo'] })
    try {
      const dbPath = path.join(fx.root, 'index.db')
      const first = reindex(fx.root, dbPath)
      const second = reindex(fx.root, dbPath)
      expect(second).toEqual(first)
      expect(second).toEqual({ projects: 2, files: 3, pdfs: 1, mds: 2 })

      const db = openDb(dbPath)
      try {
        expect(db.select().from(files).all()).toHaveLength(3)
        expect(db.select().from(projects).all()).toHaveLength(2)
        expect(db.$client.prepare('pragma foreign_key_check').all()).toHaveLength(0)
      } finally {
        db.$client.close()
      }
    } finally {
      fx.cleanup()
    }
  })
})

describe('snapshot: borrar la BD y reindexar reproduce el mismo estado (2.3)', () => {
  /**
   * Volcado completo del índice para comparar. `indexed_at` se excluye a
   * propósito: es "cuándo se indexó", no parte del estado reconstruible.
   */
  function dumpDb(dbPath: string) {
    const db = openDb(dbPath)
    try {
      return {
        projects: db.select({ name: projects.name }).from(projects).orderBy(projects.name).all(),
        files: db.select().from(files).orderBy(files.path).all(),
      }
    } finally {
      db.$client.close()
    }
  }

  const sha256Of = (s: string) => createHash('sha256').update(s).digest('hex')

  it('tras mutar el disco, una BD borrada y reindexada llega al MISMO índice', () => {
    const fx = createFixture({ extraProjects: ['banco_demo'] })
    try {
      const dbPath = path.join(fx.root, 'index.db')
      reindex(fx.root, dbPath)

      // Fase 1: el disco "vive" — nuevo borrador, edición de otro, uno desaparece
      writeAtomic('demo_project/reportes/nuevo-bypass-auth.md', '# Nuevo\n', { root: fx.root })
      writeAtomic('demo_project/reportes/informe-idor.md', 'contenido reescrito', { root: fx.root })
      rmSync(fx.mdPlain) // borrador-sqli.md fuera

      reindex(fx.root, dbPath)
      const after = dumpDb(dbPath)

      // El estado realmente cambió respecto al fixture
      expect(after.projects.map((p) => p.name)).toEqual(['banco_demo', 'demo_project'])
      expect(after.files.map((f) => f.path)).toEqual([
        'demo_project/REPORTES_YWH/informe-xss-reflejado.pdf',
        'demo_project/reportes/informe-idor.md',
        'demo_project/reportes/nuevo-bypass-auth.md',
      ])
      expect(after.files[1]!.hash).toBe(sha256Of('contenido reescrito'))

      // Fase 2: la BD se pierde por completo (el índice es desechable)
      for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true })

      // Fase 3: reindexar desde una BD inexistente reproduce EXACTAMENTE el estado
      reindex(fx.root, dbPath)
      expect(dumpDb(dbPath)).toEqual(after)
    } finally {
      fx.cleanup()
    }
  })
})
