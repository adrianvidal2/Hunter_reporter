import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it, vi } from 'vitest'
const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ REPORTS_ROOT: env.root }) }))
vi.mock('@/core/ywh/token', () => ({ loadYwhToken: () => ({ jwt: 't', source: 'ui' }), TokenExpiredError: class extends Error {} }))
import { refreshReportsAction } from '@/app/reportes/actions'
import { YwhClient } from '@/core/ywh/client'
it('dbg', async () => {
  const d = mkdtempSync(join(tmpdir(), 'dbg-'))
  env.root = d
  const spy = vi.spyOn(YwhClient.prototype, 'fetchAllMyReports').mockResolvedValue({ items: [], stats: { pages: 1, items: 0, elapsedMs: 1 } })
  const res = await refreshReportsAction()
  console.log('RESULT:', JSON.stringify(res))
  console.log('CALLS:', spy.mock.calls.length)
  spy.mockRestore()
  rmSync(d, { recursive: true, force: true })
})
