import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { it, expect } from 'vitest'
import { saveReconSettings } from '@/core/recon/settings'
import { ReconRunner } from './recon-runner'

it('dbg timeout', { timeout: 20000 }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dbg2-'))
  mkdirSync(path.join(root, 'demo'), { recursive: true })
  const bin = path.join(root, 'slow.sh')
  writeFileSync(bin, '#!/usr/bin/env bash\necho up\nsleep 30\n')
  chmodSync(bin, 0o755)
  saveReconSettings({ binPaths: { nuclei: bin } })
  const runner = new ReconRunner({ root, killGraceMs: 100 })
  const res = runner.start({
    project: 'demo', toolId: 'nuclei', targets: ['api.ejemplo.com'], scope: ['api.ejemplo.com'],
    confirmed: true, timeoutMs: 2000,
  })
  console.log('START:' + JSON.stringify(res).slice(0, 60))
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 250))
    const r = runner.getRun(res.ok ? res.runId : '')
    if (!r || r.status !== 'running') { console.log('ENDED:', r?.status); break }
  }
  expect(true).toBe(true)
})
