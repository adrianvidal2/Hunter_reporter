import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createKb } from '../core/kb/kb'
import { openDb } from './db'
import { rebuildKbIndex, searchKb, chunkBody } from './kb-index'

let root: string
let dbPath: string
const created: string[] = []

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kb-index-'))
  dbPath = join(root, 'index.db')
  created.push(root)
})

afterAll(() => {
  for (const p of created) rmSync(p, { recursive: true, force: true })
})

/** KB de prueba: 2 globales (técnica con CVE + reporte) y 1 entrada POR proyecto. */
function seed(): void {
  createKb(
    {
      name: 'sqli-playbook',
      description: 'Playbook de SQLi: usar al auditar formularios con parámetros.',
      category: 'tecnica',
      tags: ['sqli'],
      body: [
        'Detecta inyección con payloads clásicos. Referencia CVE-2021-44228 para log4shell.',
        'Segunda parte: prueba el parámetro ?page= con comillas y UNION SELECT.',
        'Header X-Custom-Auth: revisar tokens de sesión en respuestas 401.',
      ].join('\n\n'),
    },
    { scope: 'global', root },
  )
  createKb(
    {
      name: 'reporte-idor',
      description: 'Playbook de redacción de IDOR; usar al redactar.',
      category: 'reporte',
      body: 'Estructura: resumen, pasos de reproducción y impacto del IDOR.',
    },
    { scope: 'global', root },
  )
  createKb(
    {
      name: 'idor-demo',
      description: 'IDOR específico del proyecto demo con patrón /api/v1/users/{id}.',
      category: 'tecnica',
      body: 'El endpoint /api/v1/users/123 filtra datos sin validar propiedad. SECRET-DEMO-TOKEN.',
    },
    { scope: 'demo', root },
  )
  createKb(
    {
      name: 'idor-otro',
      description: 'IDOR del OTRO proyecto.',
      category: 'tecnica',
      body: 'SECRET-OTRO-TOKEN en el proyecto ajeno.',
    },
    { scope: 'otro', root },
  )
}

describe('rebuildKbIndex (índice RECONSTRUIBLE desde el markdown)', () => {
  it('puebla desde TODOS los ámbitos (global + proyectos) en chunks pequeños', () => {
    seed()
    const res = rebuildKbIndex(root, dbPath)
    expect(res.entries).toBe(4)
    expect(res.chunks).toBeGreaterThanOrEqual(4) // al menos 1 por entrada
    // términos de distintas zonas del corpus se encuentran tras el rebuild
    expect(searchKb('CVE-2021-44228', { dbPath }).map((h) => h.slug)).toEqual(['sqli-playbook'])
    expect(searchKb('SECRET-DEMO-TOKEN', { project: 'demo', dbPath }).map((h) => h.slug)).toEqual(['idor-demo'])
  })

  it('reconstruible de verdad: vaciar el índice y repoblar da resultados idénticos', () => {
    seed()
    rebuildKbIndex(root, dbPath)
    const before = searchKb('playbook', { dbPath })

    // "pérdida" del índice: DELETE a mano (la verdad sigue en el markdown)
    const db = openDb(dbPath)
    db.$client.prepare('DELETE FROM kb_fts').run()
    db.$client.close()
    expect(searchKb('playbook', { dbPath })).toEqual([])

    rebuildKbIndex(root, dbPath)
    expect(searchKb('playbook', { dbPath })).toEqual(before)
  })

  it('una entrada sin cuerpo sigue indexada por title/description', () => {
    createKb(
      { name: 'solo-descripcion', description: 'DESCRIPCION-UNICA-123 para buscar.', category: 'reporte' },
      { scope: 'global', root },
    )
    rebuildKbIndex(root, dbPath)
    expect(searchKb('DESCRIPCION-UNICA-123', { dbPath }).map((h) => h.slug)).toEqual(['solo-descripcion'])
  })
})

describe('searchKb (BM25 con filtros y aislamiento)', () => {
  beforeEach(() => {
    seed()
    rebuildKbIndex(root, dbPath)
  })

  it('término exacto estilo seguridad (CVE con guiones) vía fallback literal', () => {
    const hits = searchKb('CVE-2021-44228', { dbPath })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ slug: 'sqli-playbook', scope: 'global', category: 'tecnica' })
  })

  it('sintaxis FTS5 soportada: prefijos y AND', () => {
    const hits = searchKb('sql* AND playbook', { dbPath })
    expect(hits.map((h) => h.slug)).toEqual(['sqli-playbook'])
    // prefijo sin término exacto
    expect(searchKb('log4*', { dbPath }).map((h) => h.slug)).toEqual(['sqli-playbook'])
  })

  it('dedup: el mismo slug hallado en varios chunks sale UNA vez', () => {
    // el cuerpo de sqli-playbook genera varios chunks; 'token' y el CVE están en distintos
    const byCve = searchKb('CVE-2021-44228', { dbPath })
    const byHeader = searchKb('X-Custom-Auth', { dbPath })
    expect(byCve).toHaveLength(1)
    expect(byHeader).toHaveLength(1)
    expect(byCve[0]!.slug).toBe(byHeader[0]!.slug)
  })

  it('filtro category: no se mezclan técnicas y reportes', () => {
    expect(searchKb('idor', { category: 'reporte', dbPath }).map((h) => h.slug)).toEqual(['reporte-idor'])
    // las técnicas están en ámbitos de proyecto: cada búsqueda solo ve la suya (+ global)
    expect(searchKb('idor', { category: 'tecnica', project: 'demo', dbPath }).map((h) => h.slug)).toEqual(['idor-demo'])
    expect(searchKb('idor', { category: 'tecnica', project: 'otro', dbPath }).map((h) => h.slug)).toEqual(['idor-otro'])
  })

  it('aislamiento: el filtro project NO devuelve KB de otro proyecto; la global siempre entra', () => {
    // el token secreto del proyecto demo solo sale buscando en demo
    expect(searchKb('SECRET-DEMO-TOKEN', { project: 'demo', dbPath }).map((h) => h.slug)).toEqual(['idor-demo'])
    expect(searchKb('SECRET-DEMO-TOKEN', { project: 'otro', dbPath })).toEqual([])
    expect(searchKb('SECRET-DEMO-TOKEN', { dbPath })).toEqual([]) // sin proyecto = solo global

    // la del proyecto AJENO no se cuela en la búsqueda de demo
    expect(searchKb('SECRET-OTRO-TOKEN', { project: 'demo', dbPath })).toEqual([])

    // lo global está disponible en cualquier ámbito
    expect(searchKb('log4shell', { project: 'demo', dbPath }).map((h) => h.slug)).toEqual(['sqli-playbook'])
  })

  it('query vacía, sin resultados y sintaxis rota → [] sin romper', () => {
    expect(searchKb('', { dbPath })).toEqual([])
    expect(searchKb('   ', { dbPath })).toEqual([])
    expect(searchKb('inexistente-xyz', { dbPath })).toEqual([])
    // sintaxis FTS5 rota (paréntesis, comillas sueltas, operadores sueltos): fallback literal
    expect(searchKb('"comilla sin cerrar AND ((', { dbPath })).toEqual([])
    expect(searchKb('AND OR NOT', { dbPath })).toEqual([])
  })

  it('ranking BM25: el match en título/description pesa más que en el cuerpo', () => {
    // 'playbook' está en el TÍTULO de sqli-playbook y en la DESCRIPTION de reporte-idor
    const hits = searchKb('playbook', { dbPath })
    expect(hits.map((h) => h.slug)).toEqual(['sqli-playbook', 'reporte-idor']) // título (w5) antes que descripción (w3)
    expect(hits[0]!.rank).toBeLessThan(hits[1]!.rank)
  })
})

describe('chunkBody (chunks pequeños y enfocados)', () => {
  it('agrupa párrafos hasta el tope y corta duro los párrafos enormes', () => {
    // 8 + 16 + 4 = 28 chars ≤ 30: los tres párrafos caben en UN chunk
    expect(chunkBody('p1 corto\n\np2 también corto\n\np3', 30)).toEqual([
      'p1 corto\n\np2 también corto\n\np3',
    ])

    // con tope 18: 'p1 corto' (8) no deja sitio para 'p2 también corto' (16) → chunk propio
    expect(chunkBody('p1 corto\n\np2 también corto', 18)).toEqual(['p1 corto', 'p2 también corto'])

    const huge = 'x'.repeat(500)
    const hard = chunkBody(huge, 100)
    expect(hard).toHaveLength(5)
    for (const c of hard) expect(c.length).toBeLessThanOrEqual(100)
  })

  it('vacío → []', () => {
    expect(chunkBody('', 350)).toEqual([])
    expect(chunkBody('  \n\n  \n', 350)).toEqual([])
  })

  it('integración: los chunks del rebuild respetan el tope', () => {
    createKb(
      { name: 'largo', description: 'x', category: 'tecnica', body: 'parrafo uno.\n\n' + 'y'.repeat(900) },
      { scope: 'global', root },
    )
    rebuildKbIndex(root, dbPath)
    const rows = kbFtsHits(dbPath)
    for (const r of rows) {
      if (r.slug === 'largo') expect(r.text.length).toBeLessThanOrEqual(350)
    }
  })
})

// helper de inspección directa del índice (solo tests)
function kbFtsHits(dbPath: string): { slug: string; text: string }[] {
  const db = openDb(dbPath)
  try {
    return db.$client
      .prepare('SELECT slug, text FROM kb_fts')
      .all() as { slug: string; text: string }[]
  } finally {
    db.$client.close()
  }
}
