import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sha256Content } from '@/core/fs/hash'
import { listPending } from '@/db/pending'
import { markOwnWrite } from './own-writes'
import { handleWatchEvent, type SsePayload } from './watcher-service'

const env = vi.hoisted(() => ({ root: '', db: '' }))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ REPORTS_ROOT: env.root }) }))

let root: string
let dbPath: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'watch-own-'))
  mkdirSync(path.join(root, 'demo', 'reportes'), { recursive: true })
  env.root = root
  // BD propia por test: pendientes aislados
  dbPath = path.join(root, '.test.db')
  env.db = dbPath
})

afterAll(() => {
  vi.restoreAllMocks()
})

const draftRel = 'demo/reportes/informe.md'
const draftAbs = () => path.join(root, draftRel)

const events: SsePayload[] = []
const broadcast = (p: SsePayload) => events.push(p)

const eventFor = (relPath: string) => ({
  type: 'change' as const,
  relPath,
  absPath: path.join(root, relPath),
})

describe('handleWatchEvent × own-writes (guardados de la app vs ficheros externos)', () => {
  beforeEach(() => {
    events.length = 0
    writeFileSync(draftAbs(), 'contenido-guardado-por-la-app\n')
  })

  it('guardado de la APP (saveFileAction marca) → NO genera pendiente', () => {
    markOwnWrite(draftAbs(), sha256Content('contenido-guardado-por-la-app\n'))
    handleWatchEvent(eventFor(draftRel), root, dbPath, broadcast)
    expect(listPending(dbPath)).toHaveLength(0)
    expect(events).toHaveLength(0)
  })

  it('EL CASO PEDIDO: guardado de la app + modificación externa inmediata → el 2º evento genera pendiente', () => {
    // 1º evento: la app acaba de guardar → se traga
    markOwnWrite(draftAbs(), sha256Content('contenido-guardado-por-la-app\n'))
    handleWatchEvent(eventFor(draftRel), root, dbPath, broadcast)
    expect(listPending(dbPath)).toHaveLength(0)

    // modificación EXTERNA inmediata del mismo fichero (otro contenido)
    writeFileSync(draftAbs(), 'contenido-externo-distinto\n')
    handleWatchEvent(eventFor(draftRel), root, dbPath, broadcast)

    const pending = listPending(dbPath)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.path).toBe(draftRel)
    // el hash registrado es el del contenido EXTERNO, no el del guardado
    expect(pending[0]!.hash).toBe(sha256Content('contenido-externo-distinto\n'))
    expect(events.filter((e) => e.type === 'pending')).toMatchObject([
      { type: 'pending', outcome: 'inserted' },
    ])
  })

  it('fichero que llega de verdad de fuera (copia a mano, sin marca) → pendiente siempre', () => {
    writeFileSync(path.join(root, 'demo', 'reportes', 'copiado-a-mano.md'), 'externo\n')
    handleWatchEvent(eventFor('demo/reportes/copiado-a-mano.md'), root, dbPath, broadcast)
    expect(listPending(dbPath)).toHaveLength(1)
  })

  it('externo ANTES con contenido idéntico al guardado previo… expira por TTL y vuelve a detectar', () => {
    vi.useFakeTimers()
    const content = 'mismo-contenido\n'
    writeFileSync(draftAbs(), content)
    markOwnWrite(draftAbs(), sha256Content(content))
    handleWatchEvent(eventFor(draftRel), root, dbPath, broadcast)
    expect(listPending(dbPath)).toHaveLength(0) // propia → tragado

    vi.setSystemTime(Date.now() + 10 * 60_000) // TTL de 5 min expira
    handleWatchEvent(eventFor(draftRel), root, dbPath, broadcast)
    // sin marca vigente → se registra (comportamiento conservador: externo)
    expect(listPending(dbPath)).toHaveLength(1)
    vi.useRealTimers()
  })

  it('fichero borrado entre el guardado y el evento → ni peta ni registra', () => {
    markOwnWrite(draftAbs(), sha256Content('contenido-guardado-por-la-app\n'))
    rmSync(draftAbs())
    expect(() => handleWatchEvent(eventFor(draftRel), root, dbPath, broadcast)).not.toThrow()
    expect(listPending(dbPath)).toHaveLength(0)
  })

  it('readback del flujo completo: lo persistido en disco por la app es lo que se releerá', () => {
    markOwnWrite(draftAbs(), sha256Content('contenido-guardado-por-la-app\n'))
    handleWatchEvent(eventFor(draftRel), root, dbPath, broadcast)
    expect(readFileSync(draftAbs(), 'utf8')).toContain('contenido-guardado-por-la-app')
  })
})
