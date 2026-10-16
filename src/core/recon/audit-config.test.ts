import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  AUDIT_LIMITS,
  defaultProjectAudit,
  getProjectAudit,
  loadAuditConfig,
  normalizeAuditConfig,
  normalizeProjectAudit,
  saveAuditConfig,
  setProjectAudit,
} from './audit-config'

const originalCwd = process.cwd()

beforeAll(() => {
  // settingsDir() = cwd/.settings → tmpdir propio (invariante 5.2)
  process.chdir(mkdtempSync(join(tmpdir(), 'audit-config-')))
})

afterAll(() => {
  process.chdir(originalCwd)
  rmSync(join(originalCwd, 'nada'), { force: true })
})

beforeEach(() => {
  rmSync(join(process.cwd(), '.settings', 'audit.json'), { force: true })
})

describe('normalizeProjectAudit (defaults sensatos, raro → default)', () => {
  it('vacío → deshabilitado, runRecon true (auditoría COMPLETA), agent pi, budget defaults', () => {
    const cfg = normalizeProjectAudit({})
    expect(cfg).toEqual({
      enabled: false,
      runRecon: true,
      agent: 'pi',
      budget: {
        tokens: AUDIT_LIMITS.tokens.default,
        timeMs: AUDIT_LIMITS.timeMs.default,
        maxAgents: AUDIT_LIMITS.maxAgents.default,
      },
    })
    expect(cfg.model).toBeUndefined()
    expect(cfg.promptTemplate).toBeUndefined()
  })

  it('runRecon:false y agent/model se respetan', () => {
    const cfg = normalizeProjectAudit({
      enabled: true,
      runRecon: false,
      agent: 'claude',
      model: 'sonnet-x',
      promptTemplate: '## Misión custom {{proyecto}}',
    })
    expect(cfg).toMatchObject({
      enabled: true,
      runRecon: false,
      agent: 'claude',
      model: 'sonnet-x',
      promptTemplate: '## Misión custom {{proyecto}}',
    })
  })

  it('presupuesto CLAMPADO a límites (abajo y arriba)', () => {
    const clamped = normalizeProjectAudit({
      budget: { tokens: 10, timeMs: 1, maxAgents: 999 },
    })
    expect(clamped.budget).toEqual({
      tokens: AUDIT_LIMITS.tokens.min,
      timeMs: AUDIT_LIMITS.timeMs.min,
      maxAgents: AUDIT_LIMITS.maxAgents.max,
    })
    const capped = normalizeProjectAudit({
      budget: { tokens: 9e9, timeMs: 9e9, maxAgents: 50 },
    })
    expect(capped.budget).toEqual({
      tokens: AUDIT_LIMITS.tokens.max,
      timeMs: AUDIT_LIMITS.timeMs.max,
      maxAgents: AUDIT_LIMITS.maxAgents.max,
    })
  })

  it('tipos raros → defaults (NaN, strings, budget null)', () => {
    const cfg = normalizeProjectAudit({
      enabled: 'sí',
      agent: 42,
      budget: null,
    })
    expect(cfg.enabled).toBe(false)
    expect(cfg.agent).toBe('pi')
    expect(cfg.budget.tokens).toBe(AUDIT_LIMITS.tokens.default)
  })
})

describe('normalizeAuditConfig (fichero completo)', () => {
  it('proyectos con rutas raras se descartan; basura → config vacía', () => {
    const cfg = normalizeAuditConfig({
      projects: {
        '../evil': { enabled: true },
        'ok': { enabled: true, agent: 'pi' },
      },
    })
    expect(Object.keys(cfg.projects)).toEqual(['ok'])
    expect(normalizeAuditConfig('basura').projects).toEqual({})
    expect(normalizeAuditConfig(null).projects).toEqual({})
  })
})

describe('load/save (persistencia en .settings/audit.json + round-trip)', () => {
  it('sin fichero → config deshabilitada vacía', () => {
    const cfg = loadAuditConfig()
    expect(cfg.projects).toEqual({})
    expect(getProjectAudit('demo').enabled).toBe(false)
  })

  it('round-trip estable: save → load → save produce el mismo JSON', () => {
    setProjectAudit('demo', {
      enabled: true,
      runRecon: false,
      agent: 'claude',
      model: 'sonnet-x',
      budget: { tokens: 500_000, timeMs: 4 * 60 * 60_000, maxAgents: 2 },
    })
    const first = readFileSync(join(process.cwd(), '.settings', 'audit.json'), 'utf8')
    const reloaded = loadAuditConfig()
    saveAuditConfig(reloaded)
    const second = readFileSync(join(process.cwd(), '.settings', 'audit.json'), 'utf8')
    expect(second).toBe(first)
  })

  it('fichero corrupto → deshabilitado (opt-in: sin config no corre nada)', () => {
    writeFileSync(join(process.cwd(), '.settings', 'audit.json'), '{roto')
    const cfg = loadAuditConfig()
    expect(cfg.projects).toEqual({})
    expect(getProjectAudit('demo')).toMatchObject(defaultProjectAudit())
  })
})

describe('setProjectAudit (merge + clamp + persistencia por proyecto)', () => {
  it('parchea manteniendo lo no tocado; proyectos independientes', () => {
    setProjectAudit('demo', { enabled: true, agent: 'kimi' })
    setProjectAudit('otro', { enabled: true, runRecon: false })

    const demo = getProjectAudit('demo')
    expect(demo).toMatchObject({ enabled: true, agent: 'kimi', runRecon: true })
    const otro = getProjectAudit('otro')
    expect(otro).toMatchObject({ enabled: true, runRecon: false, agent: 'pi' })
  })

  it('el budget hace merge parcial: tokens solo toca tokens', () => {
    setProjectAudit('demo', { budget: { tokens: 800_000 } })
    setProjectAudit('demo', { budget: { maxAgents: 3 } })
    const cfg = getProjectAudit('demo')
    expect(cfg.budget).toEqual({
      tokens: 800_000,
      timeMs: AUDIT_LIMITS.timeMs.default,
      maxAgents: 3,
    })
  })

  it('setProjectAudit con enabled true y clamp de presupuesto en la misma pasada', () => {
    setProjectAudit('demo', { enabled: true, budget: { timeMs: 999 } })
    expect(getProjectAudit('demo').budget.timeMs).toBe(AUDIT_LIMITS.timeMs.min)
    expect(getProjectAudit('demo').enabled).toBe(true)
  })
})
