import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { markOwnWrite, peekOwnWrite } from './own-writes'

const root = mkdtempSync(path.join(tmpdir(), 'own-writes-'))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  vi.useRealTimers()
})

/** Fichero único por test (los registros son por path: no colisionan). */
let counter = 0
function nextFile(name = `f${++counter}.md`): string {
  const p = path.join(root, name)
  writeFileSync(p, 'x')
  return p
}

describe('own-writes (registro de escrituras de la app)', () => {
  it('marcar y consultar devuelve el hash; consultar NO consume (add+change del mismo write)', () => {
    const f = nextFile()
    markOwnWrite(f, 'hash-1')
    expect(peekOwnWrite(f)).toBe('hash-1')
    expect(peekOwnWrite(f)).toBe('hash-1') // sigue ahí para el segundo evento
    // reescribir el marcador con otro hash lo actualiza (segundo guardado)
    markOwnWrite(f, 'hash-2')
    expect(peekOwnWrite(f)).toBe('hash-2')
  })

  it('TTL: la entrada expira sola si el evento del watcher nunca llega', () => {
    vi.useFakeTimers()
    const f = nextFile()
    markOwnWrite(f, 'hash-ttl')
    expect(peekOwnWrite(f)).toBe('hash-ttl')
    vi.setSystemTime(Date.now() + 10 * 60_000) // > TTL de 5 min
    expect(peekOwnWrite(f)).toBeNull()
    vi.useRealTimers()
  })

  it('path desconocido → null', () => {
    expect(peekOwnWrite(path.join(root, 'nunca-marcado.md'))).toBeNull()
  })
})
