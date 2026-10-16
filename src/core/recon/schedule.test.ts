import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  normalizeScheduleConfig,
  passiveLightStages,
  shouldRun,
} from './schedule'

describe('passiveLightStages (REGLA SAGRADA: solo passive/light en automático)', () => {
  it('scope wildcard → subfinder/dnsx/httpx/katana/gf; JAMÁS nuclei (activo)', () => {
    const stages = passiveLightStages(['*.ejemplo.com'])
    expect(stages).toEqual(['subfinder', 'dnsx', 'httpx', 'katana', 'gf'])
    expect(stages).not.toContain('nuclei')
  })

  it('scope solo host → arranca en httpx, sin enumeración', () => {
    expect(passiveLightStages(['api.ejemplo.com'])).toEqual(['httpx', 'katana', 'gf'])
  })

  it('las URLs (vía sqlmap/dalfox, explotación) JAMÁS entran en el automático', () => {
    const stages = passiveLightStages(['https://app.ejemplo.com/login'])
    expect(stages).toEqual([]) // solo-URLs: la lane es explotación → nada automático
    const mixed = passiveLightStages(['*.ejemplo.com', 'https://app.ejemplo.com/login'])
    expect(mixed).not.toContain('sqlmap')
    expect(mixed).not.toContain('dalfox')
    expect(mixed).not.toContain('nuclei')
  })

  it('scope vacío → []', () => {
    expect(passiveLightStages([])).toEqual([])
  })

  it('verificación por risk del catálogo: todo lo del scheduler es passive/light', () => {
    const stages = passiveLightStages(['*.ejemplo.com'])
    const ACTIVE = new Set(['nmap', 'ffuf', 'gobuster', 'nuclei', 'sqlmap', 'dalfox'])
    for (const id of stages) expect(ACTIVE.has(id)).toBe(false)
  })
})

describe('shouldRun (intervalo con reloj inyectable)', () => {
  const NOW = Date.parse('2026-01-02T12:00:00Z')

  it('sin ciclo previo → toca', () => {
    expect(shouldRun(NOW, undefined, 60)).toBe(true)
  })

  it('respeta el intervalo: antes no, después sí', () => {
    const last = new Date(NOW - 30 * 60_000).toISOString()
    expect(shouldRun(NOW, last, 60)).toBe(false) // 30 min < 60 min
    expect(shouldRun(NOW + 31 * 60_000, last, 60)).toBe(true)
  })

  it('lastCycleAt corrupto → toca (no se queda bloqueado para siempre)', () => {
    expect(shouldRun(NOW, 'no-es-fecha', 60)).toBe(true)
  })
})

describe('normalizeScheduleConfig (tolerante)', () => {
  it('JSON válido → config normalizada con defaults de intervalo', () => {
    const cfg = normalizeScheduleConfig({
      projects: { demo: { enabled: true, intervalMinutes: 60 }, otro: {} },
    })
    expect(cfg.projects.demo).toEqual({ enabled: true, intervalMinutes: 60 })
    expect(cfg.projects.otro).toEqual({ enabled: false, intervalMinutes: DEFAULT_INTERVAL_MINUTES })
  })

  it('intervalo por debajo del mínimo → sube al mínimo; tipos raros → defaults', () => {
    const cfg = normalizeScheduleConfig({
      projects: {
        a: { enabled: true, intervalMinutes: 1 },
        b: { enabled: 'sí', intervalMinutes: '60' },
        c: null,
      },
    })
    expect(cfg.projects.a.intervalMinutes).toBe(MIN_INTERVAL_MINUTES)
    expect(cfg.projects.b.enabled).toBe(false)
    expect(cfg.projects.c.enabled).toBe(false)
  })

  it('proyectos con rutas raras se descartan; basura total → config vacía', () => {
    const cfg = normalizeScheduleConfig({
      projects: { '../evil': { enabled: true }, 'ok': { enabled: true } },
    })
    expect(Object.keys(cfg.projects)).toEqual(['ok'])
    expect(normalizeScheduleConfig('basura').projects).toEqual({})
    expect(normalizeScheduleConfig(null).projects).toEqual({})
  })
})
