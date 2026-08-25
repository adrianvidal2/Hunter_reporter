import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFixture } from '../test/fixtures/fixture'
import { listLlmRuns, recordLlmRun } from './runs'

describe('recordLlmRun / listLlmRuns (8.9)', () => {
  it('éxito: fila con modelo, tokens, duración y coste estimado deducible', () => {
    const fx = createFixture()
    try {
      const dbPath = path.join(fx.root, 'index.db')
      const id = recordLlmRun(
        {
          path: 'demo_project/reportes/x.md',
          model: 'deepseek-chat',
          attempts: 1,
          latencyMs: 7_743,
          promptTokens: 1_972,
          completionTokens: 1_402,
          status: 'ok',
        },
        dbPath,
      )
      expect(id).toBeGreaterThan(0)

      const [row] = listLlmRuns(10, dbPath)
      expect(row.model).toBe('deepseek-chat')
      expect(row.promptTokens).toBe(1_972)
      expect(row.completionTokens).toBe(1_402)
      expect(row.latencyMs).toBe(7_743)
      expect(row.status).toBe('ok')
      expect(row.costUsd).not.toBeNull()
      expect(row.costUsd!).toBeGreaterThan(0)
      expect(row.costBasis).toContain('estimado')
    } finally {
      fx.cleanup()
    }
  })

  it('fallo: status=kind, mensaje guardado, coste null si no hay tokens', () => {
    const fx = createFixture()
    try {
      const dbPath = path.join(fx.root, 'index.db')
      recordLlmRun(
        {
          path: null,
          model: 'modelo-desconocido',
          attempts: 3,
          latencyMs: 20_000,
          status: 'rate_limit',
          error: 'HTTP 429',
        },
        dbPath,
      )
      const [row] = listLlmRuns(1, dbPath)
      expect(row.status).toBe('rate_limit')
      expect(row.error).toBe('HTTP 429')
      expect(row.attempts).toBe(3)
      expect(row.costUsd).toBeNull() // sin tokens → no deducible
    } finally {
      fx.cleanup()
    }
  })

  it('listado en orden descendente (más reciente primero)', () => {
    const fx = createFixture()
    try {
      const dbPath = path.join(fx.root, 'index.db')
      recordLlmRun({ path: null, model: 'm', attempts: 1, latencyMs: 1, status: 'ok' }, dbPath)
      recordLlmRun({ path: null, model: 'm', attempts: 1, latencyMs: 2, status: 'ok' }, dbPath)
      const rows = listLlmRuns(2, dbPath)
      expect(rows[0]!.latencyMs).toBe(2)
      expect(rows[1]!.latencyMs).toBe(1)
    } finally {
      fx.cleanup()
    }
  })
})
