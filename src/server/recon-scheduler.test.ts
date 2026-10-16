import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReconScheduler, closeReconScheduler, getReconScheduler } from './recon-scheduler'
import { listReconNews } from '../db/recon-news'

/**
 * Scheduler con dependencias INYECTADAS (getContext/runPipeline/nowMs): se
 * prueba la lógica (opt-in, intervalo, no solape, solo pasivo/ligero) sin
 * lanzar binarios reales.
 */

let root: string
let dbPath: string
let now: number
const created: string[] = []
const originalCwd = process.cwd()

// settingsDir() = cwd/.settings → tmpdir propio (invariante 5.2: los tests
// JAMÁS tocan el .settings real)
beforeAll(() => {
  process.chdir(mkdtempSync(join(tmpdir(), 'recon-sched-settings-')))
})

afterAll(() => {
  process.chdir(originalCwd)
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'recon-sched-'))
  dbPath = join(root, 'index.db')
  now = Date.parse('2026-01-02T12:00:00Z')
  created.push(root)
  mkdirSync(join(root, 'demo'), { recursive: true })
  // opt-in limpio entre tests (el .settings del tmp es compartido en el fichero)
  rmSync(join(process.cwd(), '.settings', 'recon-schedule.json'), { force: true })
})

afterAll(() => {
  process.chdir(originalCwd)
  for (const p of created) rmSync(p, { recursive: true, force: true })
})

type SchedulerOptionsShallow = NonNullable<ConstructorParameters<typeof ReconScheduler>[0]>

function newScheduler(
  overrides: {
    getContext?: SchedulerOptionsShallow['getContext']
    runPipeline?: SchedulerOptionsShallow['runPipeline']
    onNews?: SchedulerOptionsShallow['onNews']
  } = {},
): ReconScheduler {
  return new ReconScheduler({
    root,
    dbPath,
    nowMs: () => now,
    // defaults SIEMPRE inyectados: nada de este fichero depende de env real
    getContext: async () => ({ ok: true, targets: ['*.ejemplo.com'] }),
    runPipeline: async () => ({ ok: true }),
    onNews: () => {},
    ...overrides,
  })
}

describe('ReconScheduler · REGLA SAGRADA: solo passive/light en automático', () => {
  it('el ciclo lanza SOLO etapas passive/light del plan (jamás nuclei/sqlmap)', async () => {
    const runPipeline = vi.fn().mockResolvedValue({ ok: true })
    const scheduler = newScheduler({ runPipeline })
    await scheduler.setProject('demo', { enabled: true })
    const res = await scheduler.runCycle('demo')
    expect(res.ok).toBe(true)
    expect(res.stages).toEqual(['subfinder', 'dnsx', 'httpx', 'katana', 'gf'])
    expect(runPipeline.mock.calls[0]![1]).toEqual(['subfinder', 'dnsx', 'httpx', 'katana', 'gf'])
    const flat = JSON.stringify(runPipeline.mock.calls)
    expect(flat).not.toContain('nuclei')
    expect(flat).not.toContain('sqlmap')
    expect(flat).not.toContain('dalfox')
  })

  it('opt-in: proyecto sin monitorización activada → NADA se lanza', async () => {
    const runPipeline = vi.fn().mockResolvedValue({ ok: true })
    const scheduler = newScheduler({ runPipeline })
    // sin setProject(enabled) → desactivado por defecto
    const res = await scheduler.runCycle('demo')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/opt-in|monitorización/i)
    expect(runPipeline).not.toHaveBeenCalled()
    await scheduler.tick() // el tick tampoco lanza nada
    expect(runPipeline).not.toHaveBeenCalled()
  })
})

describe('ReconScheduler · intervalo y no solape', () => {
  it('marca el ciclo y respeta el intervalo con el reloj inyectado', async () => {
    const runPipeline = vi.fn().mockResolvedValue({ ok: true })
    const scheduler = newScheduler({ runPipeline })
    await scheduler.setProject('demo', { enabled: true, intervalMinutes: 60 })

    await scheduler.runCycle('demo')
    const schedule = scheduler.getProjectSchedule('demo')
    expect(schedule.lastCycleAt).toBeDefined()

    // 10 min después: aún no toca
    now += 10 * 60_000
    await scheduler.tick()
    expect(runPipeline).toHaveBeenCalledTimes(1)

    // 61 min después: toca
    now += 61 * 60_000
    await scheduler.tick()
    expect(runPipeline).toHaveBeenCalledTimes(2)
  })

  it('no solapa: mientras un ciclo corre, el proyecto no relanza', async () => {
    let resolveRun!: (v: { ok: boolean }) => void
    const runPipeline = vi.fn().mockImplementation(
      () => new Promise<{ ok: boolean }>((res) => { resolveRun = res }),
    )
    const scheduler = newScheduler({ runPipeline })
    await scheduler.setProject('demo', { enabled: true, intervalMinutes: 60 })

    const first = scheduler.runCycle('demo')
    // mientras corre: due=false y un segundo runCycle directo da error
    expect(scheduler.isDue('demo')).toBe(false)
    const second = await scheduler.runCycle('demo')
    expect(second.ok).toBe(false)
    expect(second.error).toMatch(/Ya hay un ciclo/)
    expect(runPipeline).toHaveBeenCalledTimes(1)

    resolveRun({ ok: true })
    const res = await first
    expect(res.ok).toBe(true)
    // el intervalo se acaba de consumir → no due; pasado el intervalo → due
    expect(scheduler.isDue('demo')).toBe(false)
    now += 61 * 60_000
    expect(scheduler.isDue('demo')).toBe(true)
  })
})

describe('ReconScheduler · 9b: diff del ciclo → novedades', () => {
  it('un asset nuevo entre ciclos se registra y se notifica; sin cambios → sin ruido', async () => {
    // dos runs de httpx en disco: el diff dará 'nuevo.ejemplo.com' como añadido
    const d1 = join(root, 'demo', 'pentest', 'recon', 'httpx', '20260101-000000')
    const d2 = join(root, 'demo', 'pentest', 'recon', 'httpx', '20260102-000000')
    mkdirSync(d1, { recursive: true })
    mkdirSync(d2, { recursive: true })
    writeFileSync(join(d1, 'output.log'), 'https://viejo.ejemplo.com\n')
    writeFileSync(join(d2, 'output.log'), 'https://viejo.ejemplo.com\nhttps://nuevo.ejemplo.com\n')

    const onNews = vi.fn()
    const scheduler = newScheduler({ runPipeline: async () => ({ ok: true }), onNews })
    await scheduler.setProject('demo', { enabled: true })
    const res = await scheduler.runCycle('demo')
    expect(res.ok).toBe(true)

    // novedades registradas en la BD y notificadas
    expect(onNews).toHaveBeenCalledTimes(1)
    expect(onNews.mock.calls[0]![0]).toBe('demo')
    expect(onNews.mock.calls[0]![1]).toEqual([{ tool: 'httpx', items: ['nuevo.ejemplo.com'] }])
    const rows = listReconNews({ project: 'demo', dbPath })
    expect(rows.map((r) => r.item)).toContain('nuevo.ejemplo.com')

    // segundo ciclo SIN cambios → sin novedades, sin ruido
    onNews.mockClear()
    now += 61 * 60_000
    await scheduler.runCycle('demo')
    expect(onNews).not.toHaveBeenCalled()
    expect(listReconNews({ project: 'demo', dbPath }).filter((r) => r.item === 'nuevo.ejemplo.com')).toHaveLength(1)
  })
})

describe('singleton del scheduler (globalThis, hot-reload safe)', () => {
  it('getReconScheduler devuelve la MISMA instancia por root; close la desregistra', () => {
    const a = getReconScheduler({ root, dbPath })
    const b = getReconScheduler({ root, dbPath })
    expect(a).toBe(b)
    closeReconScheduler(root)
    const c = getReconScheduler({ root, dbPath })
    expect(c).not.toBe(a)
    closeReconScheduler(root)
  })
})
