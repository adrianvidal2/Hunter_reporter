import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ REPORTS_ROOT: env.root }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/server/recon-pipeline', () => ({
  // pipeline simulado: completa al instante (los tests no lanzan binarios)
  startPipeline: vi.fn(() => ({ ok: true, pipelineId: 'pipe-test', outputDir: '' })),
  getPipeline: vi.fn(() => ({ ok: true, status: 'done' })),
}))
// el contexto real depende de programa.json del fixture de disco
import {
  clearReconNewsAction,
  getScheduleStatusAction,
  listReconNewsAction,
  runCycleNowAction,
  setScheduleAction,
} from './actions'
import { recordReconNews } from '@/db/recon-news'

const root = mkdtempSync(join(tmpdir(), 'novedades-actions-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

beforeEach(() => {
  env.root = root
  mkdirSync(join(root, 'demo'), { recursive: true })
  // programa.json para que el proyecto tenga contexto de recon
  writeFileSync(
    join(root, 'demo', 'programa.json'),
    JSON.stringify({
      pid: 'x',
      title: 'Demo',
      slug: 'demo-program',
      type: 'bug-bounty',
      public: false,
      disabled: false,
      archived: false,
      bounty: true,
      bounty_reward_min: 10,
      bounty_reward_max: 100,
      scopes_count: 1,
      reports_count: 0,
      business_unit: null,
      thumbnail: null,
      user_agent: 'Test-UA',
      scopes: [{ scope: '*.ejemplo.com', scope_type: 'web-application', scope_type_name: 'Web', asset_value: 'CRITICAL', report_count: null }],
      reward_grid_default: null,
      reward_grid_critical: null,
      reward_grid_high: null,
      reward_grid_medium: null,
      reward_grid_low: null,
      reward_grid_very_low: null,
      stats: null,
    }),
  )
  rmSync(join(process.cwd(), '.settings', 'recon-schedule.json'), { force: true })
  rmSync(join(root, 'demo', 'pentest'), { recursive: true, force: true })
  // la BD por defecto de las actions vive en tmp (nada toca datos reales)
  process.env.DB_PATH = join(root, 'index.db')
  rmSync(join(root, 'index.db'), { force: true })
})

describe('getScheduleStatusAction (estado del scheduler por proyecto)', () => {
  it('lista proyectos con su opt-in/intervalo/último ciclo', async () => {
    await setScheduleAction('demo', { enabled: true, intervalMinutes: 120 })
    const res = await getScheduleStatusAction()
    expect(res.ok).toBe(true)
    if (!res.ok || !res.projects) return
    const demo = res.projects.find((p) => p.project === 'demo')!
    expect(demo).toMatchObject({
      project: 'demo',
      enabled: true,
      intervalMinutes: 120,
      hasProgram: true,
    })
    expect(demo.lastCycleAt).toBeUndefined() // sin ciclos aún
  })
})

describe('setScheduleAction (opt-in explícito con validación)', () => {
  it('activa/desactiva y valida el proyecto', async () => {
    expect((await setScheduleAction('demo', { enabled: true })).ok).toBe(true)
    expect((await getScheduleStatusAction()).ok && (await getScheduleStatusAction()).projects?.[0]?.enabled).toBe(true)
    expect(await setScheduleAction('no-existe', { enabled: true })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/No existe el proyecto/),
    })
  })

  it('intervalo por debajo del mínimo se clampea', async () => {
    await setScheduleAction('demo', { enabled: true, intervalMinutes: 5 })
    const res = await getScheduleStatusAction()
    expect(res.ok && res.projects?.[0]?.intervalMinutes).toBe(15)
  })
})

describe('runCycleNowAction (mismo camino que el automático)', () => {
  it('proyecto sin programa.json → error claro; con programa → corre el ciclo', async () => {
    mkdirSync(join(root, 'sin-programa'), { recursive: true })
    const noProgram = await runCycleNowAction('sin-programa')
    // sin contexto de programa el ciclo no puede construir targets
    expect(noProgram.ok).toBe(false)

    await setScheduleAction('demo', { enabled: true }) // opt-in primero
    const res = await runCycleNowAction('demo')
    expect(res.ok).toBe(true)
    expect(res.stages).toEqual(['subfinder', 'dnsx', 'httpx', 'katana', 'gf']) // solo pasivo/ligero
  })
})

describe('listReconNewsAction / clearReconNewsAction', () => {
  it('lista por proyecto y limpia', async () => {
    recordReconNews('demo', 'httpx', ['nuevo.ejemplo.com'])
    recordReconNews('otro', 'httpx', ['otro.ejemplo.com'])

    const all = await listReconNewsAction()
    expect(all.ok ? all.news : []).toHaveLength(2)
    const demo = await listReconNewsAction('demo')
    expect(demo.ok ? demo.news.map((n) => n.item) : []).toEqual(['nuevo.ejemplo.com'])

    await clearReconNewsAction('demo')
    const afterDemo = await listReconNewsAction('demo')
    expect(afterDemo.ok ? afterDemo.news : 'no-vacío').toEqual([])
    const afterOtro = await listReconNewsAction('otro')
    expect(afterOtro.ok ? afterOtro.news : 'no-vacío').toHaveLength(1)
  })
})
