import path from 'node:path'
import { writeFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFixture, type Fixture } from '../test/fixtures/fixture'
import { NotApprovedError } from '@/core/reports/rewrite'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ REPORTS_ROOT: env.root }),
}))

import { registerPending } from '@/db/pending'
import { runRewriteFor } from './rewrite'

describe('runRewriteFor (guard 6.5 ⚠️ + extension point)', () => {
  let fx: Fixture
  let dbPath: string

  beforeEach(() => {
    fx = createFixture()
    env.root = fx.root
    dbPath = path.join(fx.root, 'index.db')
    return () => fx.cleanup()
  })

  it('⚠️ en estado pending NO se llama al LLM (executor nunca se invoca)', async () => {
    writeFileSync(path.join(fx.draftsDir, 'detectado.md'), '# contenido')
    registerPending(
      { path: 'demo_project/reportes/detectado.md', hash: 'h1', size: 12, mtimeMs: 1 },
      dbPath,
    )

    const llm = vi.fn().mockResolvedValue('markdown reescrito')
    await expect(
      runRewriteFor('demo_project/reportes/detectado.md', llm, dbPath),
    ).rejects.toBeInstanceOf(NotApprovedError)
    expect(llm).not.toHaveBeenCalled() // el corazón de 6.5
  })

  it('fila inexistente → también rechazado sin tocar el executor', async () => {
    const llm = vi.fn()
    await expect(
      runRewriteFor('demo_project/reportes/nunca-visto.md', llm, dbPath),
    ).rejects.toThrow(NotApprovedError)
    expect(llm).not.toHaveBeenCalled()
  })

  it('approved + executor → se invoca UNA vez con path/content/hash del disco', async () => {
    const nuevo = path.join(fx.draftsDir, 'aprobado.md')
    writeFileSync(nuevo, '# Aprobado por humano')
    registerPending(
      { path: 'demo_project/reportes/aprobado.md', hash: 'abc', size: 19, mtimeMs: 1 },
      dbPath,
    )
    // decisión humana registrada
    const { resolvePending } = await import('@/db/pending')
    expect(resolvePending('demo_project/reportes/aprobado.md', 'approved', dbPath)).toBe(true)

    const llm = vi.fn().mockResolvedValue('ok')
    const res = await runRewriteFor('demo_project/reportes/aprobado.md', llm, dbPath)
    expect(res).toEqual({ ran: true })
    expect(llm).toHaveBeenCalledTimes(1)
    expect(llm).toHaveBeenCalledWith({
      path: 'demo_project/reportes/aprobado.md',
      content: '# Aprobado por humano',
      hash: 'abc',
    })
  })

  it('approved sin executor (hoy) → ran:false con motivo, sin lanzar', async () => {
    registerPending(
      { path: 'demo_project/reportes/informe-idor.md', hash: 'x', size: 1, mtimeMs: 1 },
      dbPath,
    )
    const { resolvePending } = await import('@/db/pending')
    resolvePending('demo_project/reportes/informe-idor.md', 'approved', dbPath)

    const res = await runRewriteFor('demo_project/reportes/informe-idor.md', undefined, dbPath)
    expect(res.ran).toBe(false)
    expect(res.reason).toMatch(/bloque 8/)
  })
})
