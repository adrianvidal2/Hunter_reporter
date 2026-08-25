import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cacheAgeMs,
  readReportsCache,
  writeReportsCache,
} from './reports-cache'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ REPORTS_ROOT: env.root }) }))
vi.mock('@/core/ywh/token', () => ({
  loadYwhToken: () => ({ jwt: 'test-jwt', source: 'ui' }),
  TokenExpiredError: class extends Error {},
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { refreshReportsAction } from '@/app/reportes/actions'

const dir = mkdtempSync(join(tmpdir(), 'reports-cache-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
let caseN = 0
const fresh = () => join(dir, `case-${caseN++}`)

const SAMPLE = { id: 1, local_id: 'YWH-1', title: 'Rep', scope: '', program: null, status: { workflow_state: 'under_review' }, cvss: null, hunter: null, reward: null, cost_credits: null, currency: null, marked_as: 'R', collaborative: false, created_at: '2026-08-20T17:44:34+02:00', changed_at: null, ask_for_fix_verification_status: 'UNKNOWN' }

function writeJson(items: unknown, savedAt: number) {
  const { mkdirSync, writeFileSync } = require('node:fs')
  mkdirSync(join(env.root, '.config'), { recursive: true })
  writeFileSync(join(env.root, '.config', 'reports-cache.json'), JSON.stringify({ savedAt, items }))
}

describe('cache a disco (reports-cache)', () => {
  beforeEach(() => { env.root = fresh() })

  it('write + read roundtrip', () => {
    writeReportsCache([SAMPLE as never], env.root, 1_700_000_000_000)
    const c = readReportsCache(env.root)
    expect(c?.items[0]!.id).toBe(1)
    expect(c?.savedAt).toBe(1_700_000_000_000)
  })

  it('cache ausente → null (estado vacío)', () => {
    expect(readReportsCache(env.root)).toBeNull()
  })

  it('cache corrupta → null', () => {
    writeJson({ foo: 1 }, 123)
    expect(readReportsCache(env.root)).toBeNull()
  })

  it('cacheAgeMs', () => {
    const c = { savedAt: 1_700_000_000_000, items: [SAMPLE as never] }
    expect(cacheAgeMs(c, 1_700_000_060_000)).toBe(60_000)
    expect(cacheAgeMs(null, 1_700_000_060_000)).toBe(0)
  })
})

describe('refreshReportsAction (fallo mantiene cache)', () => {
  beforeEach(() => { env.root = fresh() })

  it('con cache presente y fallo de red/auth → mantiene la cache y avisa', async () => {
    writeJson([{ ...SAMPLE, id: 42 }], Date.now() - 5_000)
    const client = await import('@/core/ywh/client')
    const spy = vi.spyOn(client.YwhClient.prototype, 'fetchAllMyReports')
      .mockRejectedValue(new client.YwhApiError('auth', 'Sesión caducada, renueva el token en Ajustes.', 401))

    const res = await refreshReportsAction()
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('Sesión caducada')
    }
    // la cache NO se borró
    const cache = readReportsCache(env.root)
    expect(cache?.items[0]!.id).toBe(42)
    spy.mockRestore()
  })

  it('sin cache y fallo → vacío + aviso, no crea cache', async () => {
    const client = await import('@/core/ywh/client')
    const spy = vi.spyOn(client.YwhClient.prototype, 'fetchAllMyReports')
      .mockRejectedValue(new client.YwhApiError('auth', 'x', 401))
    const res = await refreshReportsAction()
    expect(res.ok).toBe(false)
    expect(res.view.items).toEqual([])
    expect(existsSync(join(env.root, '.config', 'reports-cache.json'))).toBe(false)
    spy.mockRestore()
  })

  it('éxito → escribe cache nueva', async () => {
    const client = await import('@/core/ywh/client')
    const spy = vi.spyOn(client.YwhClient.prototype, 'fetchAllMyReports')
      .mockResolvedValue({ items: [{ ...SAMPLE, id: 7 } as never], stats: { pages: 1, items: 1, elapsedMs: 1 } })
    const res = await refreshReportsAction()
    expect(res.ok).toBe(true)
    const cache = readReportsCache(env.root)
    expect(cache?.items[0]!.id).toBe(7)
    spy.mockRestore()
  })
})
