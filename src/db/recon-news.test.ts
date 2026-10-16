import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { clearReconNews, listReconNews, recordReconNews } from './recon-news'
import { closeWatcherService, getWatcherService, notifyReconNews } from '../server/watcher-service'

let dbPath: string
let root: string
const created: string[] = []

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'recon-news-'))
  dbPath = join(root, 'index.db')
  created.push(root)
})

afterAll(async () => {
  for (const p of created) rmSync(p, { recursive: true, force: true })
  await closeWatcherService(root).catch(() => {})
})

describe('recordReconNews (alta idempotente por proyecto+tool+item)', () => {
  it('items nuevos → inserted; repetidos → refresh sin duplicar', () => {
    const first = recordReconNews('demo', 'httpx', ['a.ejemplo.com', 'b.ejemplo.com'], dbPath)
    expect(first).toEqual({ inserted: 2, refreshed: 0 })
    const second = recordReconNews('demo', 'httpx', ['a.ejemplo.com', 'c.ejemplo.com'], dbPath)
    expect(second).toEqual({ inserted: 1, refreshed: 1 })
    const rows = listReconNews({ project: 'demo', dbPath })
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.item).sort()).toEqual(['a.ejemplo.com', 'b.ejemplo.com', 'c.ejemplo.com'])
  })

  it('aislamiento por proyecto y herramienta', () => {
    recordReconNews('demo', 'httpx', ['a.ejemplo.com'], dbPath)
    recordReconNews('demo', 'subfinder', ['a.ejemplo.com'], dbPath)
    recordReconNews('otro', 'httpx', ['a.ejemplo.com'], dbPath)
    expect(listReconNews({ project: 'demo', dbPath })).toHaveLength(2)
    expect(listReconNews({ project: 'otro', dbPath })).toHaveLength(1)
    // filtro por tool al listar no existe (es por project), pero la fila guarda la tool
    expect(listReconNews({ project: 'demo', dbPath }).every((r) => r.tool === 'httpx' || r.tool === 'subfinder')).toBe(true)
  })

  it('items vacíos o en blanco se ignoran', () => {
    expect(recordReconNews('demo', 'httpx', ['', '  '], dbPath)).toEqual({ inserted: 0, refreshed: 0 })
    expect(listReconNews({ project: 'demo', dbPath })).toEqual([])
  })
})

describe('listReconNews (orden y límite)', () => {
  it('más recientes primero; respeta limit', () => {
    recordReconNews('demo', 'subfinder', ['v1.ejemplo.com'], dbPath)
    recordReconNews('demo', 'httpx', ['v2.ejemplo.com'], dbPath)
    recordReconNews('demo', 'katana', ['v3.ejemplo.com'], dbPath)
    const rows = listReconNews({ project: 'demo', limit: 2, dbPath })
    expect(rows).toHaveLength(2) // las dos últimas insertadas
    expect(rows.map((r) => r.item)).toEqual(['v3.ejemplo.com', 'v2.ejemplo.com'])
  })
})

describe('clearReconNews (índice reconstruible, no es verdad)', () => {
  it('borra por proyecto o todo', () => {
    recordReconNews('demo', 'httpx', ['a.ejemplo.com'], dbPath)
    recordReconNews('otro', 'httpx', ['b.ejemplo.com'], dbPath)
    expect(clearReconNews('demo', dbPath)).toBe(1)
    expect(listReconNews({ project: 'demo', dbPath })).toEqual([])
    expect(listReconNews({ project: 'otro', dbPath })).toHaveLength(1)
    expect(clearReconNews(undefined, dbPath)).toBe(1)
    expect(listReconNews({ dbPath })).toEqual([])
  })
})

describe('broadcast SSE de novedades (canal del watcher-service)', () => {
  it('emit llega a los suscriptores con el payload de recon-news', async () => {
    const service = getWatcherService(root, dbPath)
    const received: unknown[] = []
    const unsubscribe = service.subscribe((payload) => received.push(payload))
    try {
      service.emit({ type: 'recon-news', project: 'demo', total: 3 })
      const news = received.filter((p) => (p as { type: string }).type === 'recon-news')
      expect(news).toHaveLength(1)
      expect(news[0]).toMatchObject({ type: 'recon-news', project: 'demo', total: 3 })
    } finally {
      unsubscribe()
    }
    // tras desuscribir: nada
    service.emit({ type: 'recon-news', project: 'demo', total: 1 })
    expect(received.filter((p) => (p as { type: string }).type === 'recon-news')).toHaveLength(1)
  })

  it('notifyReconNews no revienta si el servicio no existe para el root', () => {
    expect(() => notifyReconNews(join(root, 'no-existe'), { project: 'x', total: 1 })).not.toThrow()
  })
})
