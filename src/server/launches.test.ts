import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendLaunch, readLaunches } from './launches'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ REPORTS_ROOT: env.root }) }))

const root = mkdtempSync(join(tmpdir(), 'launches-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const REC = { timestamp: 1, provider: 'pi', scopeSeleccionado: ['https://a.test'], mode: 'orca', ok: true, worktreeId: 'wt-1', handle: 'h-1' }

describe('launches.json (append a array)', () => {
  beforeEach(() => { env.root = root })

  it('append crea el fichero en pentest/ con el array', () => {
    appendLaunch('demo', REC)
    const raw = JSON.parse(readFileSync(join(root, 'demo', 'pentest', 'launches.json'), 'utf8'))
    expect(raw.launches).toHaveLength(1)
    expect(raw.launches[0]!.worktreeId).toBe('wt-1')
  })

  it('append añade al final sin borrar previos', () => {
    appendLaunch('demo', { ...REC, timestamp: 2 })
    appendLaunch('demo', { ...REC, timestamp: 3 })
    const all = readLaunches('demo', root)
    expect(all.map((l) => l.timestamp)).toEqual([1, 2, 3])
  })

  it('readLaunches devuelve [] si no existe', () => {
    expect(readLaunches('no-existe', root)).toEqual([])
  })
})