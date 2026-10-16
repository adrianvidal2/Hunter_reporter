import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveReconSettings, type ReconSettings } from '@/core/recon/settings'
import { ReconRunner } from './recon-runner'
import { cancelPipeline, getPipeline, startPipeline, type PipelineSnapshot } from './recon-pipeline'

// pipelines completos con spawns reales: margen muy por encima del default
vi.setConfig({ testTimeout: 30_000 })

/**
 * Orquestador del pipeline con el runner REAL (scripts bash como binarios,
 * patrón recon-runner.test.ts). Los tests NO tocan datos reales: root y
 * settingsDir() viven en tmpdirs.
 */

let root: string
let binDir: string
let project: string
const originalCwd = process.cwd()
const created: string[] = []

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'recon-pipeline-'))
  created.push(root)
  binDir = path.join(root, 'bin')
  mkdirSync(binDir, { recursive: true })
  // settingsDir() = cwd/.settings → tmpdir propio: el .settings real queda INTACTO
  process.chdir(mkdtempSync(path.join(tmpdir(), 'recon-pipeline-settings-')))
})

afterAll(() => {
  process.chdir(originalCwd)
  for (const p of created) rmSync(p, { recursive: true, force: true })
})

beforeEach(() => {
  project = `demo-${Math.random().toString(36).slice(2, 8)}`
  mkdirSync(path.join(root, project, 'reportes'), { recursive: true })
  saveReconSettings({ binPaths: {} })
})

/** Script ejecutable de prueba (bash con shebang: spawn directo, sin shell). */
function makeScript(name: string, body: string): string {
  const p = path.join(binDir, name)
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(p, 0o755)
  return p
}

function registerBins(names: string[]): void {
  const binPaths: Partial<Record<string, string>> = {}
  for (const n of names) binPaths[n] = path.join(binDir, n)
  saveReconSettings({ binPaths: binPaths as ReconSettings['binPaths'] })
}

async function waitFor<T>(fn: () => T | undefined, ms = 25_000): Promise<T> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = fn()
    if (v !== undefined) return v
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('timeout esperando condición del pipeline')
}

/** Lanza un pipeline (runner inyectado) y espera a que termine. */
async function runStages(
  stages: string[],
  opts: { confirmed?: boolean; scope?: string[]; rules?: Record<string, unknown>; timeoutMs?: number } = {},
): Promise<PipelineSnapshot | null> {
  const res = startPipeline(
    {
      project,
      scope: opts.scope ?? ['*.ejemplo.com'],
      rules: (opts.rules ?? {}) as never,
      stages,
      confirmed: opts.confirmed,
      timeoutMs: opts.timeoutMs ?? 15_000,
    },
    { runner: new ReconRunner({ root, killGraceMs: 100 }), root },
  )
  expect(res.ok).toBe(true)
  if (!res.ok) return null
  return waitFor(() => {
    const snap = getPipeline(res.pipelineId)
    return snap && snap.status !== 'running' ? snap : undefined
  })
}

/** Último run (dir más reciente) de una herramienta: lee un fichero de su dir. */
function readRunFile(toolId: string, file: string): string {
  const toolDir = path.join(root, project, 'pentest', 'recon', toolId)
  const dirs = readdirSync(toolDir).sort()
  return readFileSync(path.join(toolDir, dirs.at(-1)!, file), 'utf8')
}

const ALL_STAGES = ['subfinder', 'dnsx', 'httpx', 'katana', 'gf', 'nuclei']

/**
 * Receta estándar del pipeline de prueba:
 * subfinder encuentra dev/api/fuera (fuera de scope); dnsx solo resuelve dev
 * (api "muerta"); httpx la confirma; katana arrastra 2 URLs + 1 fuera de
 * scope; gf deja la de login; nuclei la recibe.
 */
function makeFullScripts(): void {
  makeScript('subfinder', 'cat targets.txt > bases.txt\necho dev.ejemplo.com\necho api.ejemplo.com\necho fuera.com\n')
  makeScript('dnsx', 'grep dev\n')
  makeScript('httpx', 'cat targets.txt > httpx-in.txt\nsed "s|^|https://|" targets.txt\n')
  makeScript(
    'katana',
    'cat targets.txt > katana-in.txt\n' +
      'echo "https://$(head -n1 targets.txt)/login"\n' +
      'echo "https://$(head -n1 targets.txt)/admin?id=1"\n' +
      'echo "https://fuera.com/nope"\n',
  )
  makeScript('gf', 'cat > gf-in.txt\ngrep login gf-in.txt\n')
  makeScript('nuclei', 'cat targets.txt > nuclei-in.txt\necho scanning\n')
}

describe('orquestador del pipeline (runner real)', () => {
  it('secuencia: la salida de la etapa N llena el targets.txt de N+1, siempre dentro del scope', async () => {
    makeFullScripts()
    registerBins(ALL_STAGES)
    const snap = await runStages(ALL_STAGES, { confirmed: true, rules: { rulesText: 'No automated scanners.' } })

    expect(snap?.status).toBe('done')
    expect(snap?.stages.map((s) => [s.toolId, s.status, s.itemCount])).toEqual([
      ['subfinder', 'done', 2], // dev + api; fuera.com lo corta el scope
      ['dnsx', 'done', 1], // api "muerta" en dnsx
      ['httpx', 'done', 1],
      ['katana', 'done', 2], // 3 URLs halladas, 1 fuera de scope
      ['gf', 'done', 1], // la de login
      ['nuclei', 'done', undefined],
    ])

    // la enumeración recibe la BASE del wildcard
    expect(readRunFile('subfinder', 'bases.txt')).toBe('ejemplo.com\n')
    expect(readRunFile('subfinder', 'targets.txt')).toBe('ejemplo.com\n')
    // dnsx hereda lo hallado por subfinder (dentro del scope)
    expect(readRunFile('dnsx', 'targets.txt')).toBe('dev.ejemplo.com\napi.ejemplo.com\n')
    // httpx SOLO ve lo resuelto: fuera.com (de subfinder) JAMÁS entró
    expect(readRunFile('httpx', 'targets.txt')).toBe('dev.ejemplo.com\n')
    expect(readRunFile('httpx', 'httpx-in.txt')).toBe('dev.ejemplo.com\n')
    // katana hereda los hosts vivos de httpx
    expect(readRunFile('katana', 'katana-in.txt')).toBe('dev.ejemplo.com\n')
    // gf corre un run por patrón fijo (primer test: sin runs previos de gf)
    expect(readdirSync(path.join(root, project, 'pentest', 'recon', 'gf'))).toHaveLength(6)
    // nuclei recibe la URL filtrada por gf (normalizada por el runner, como
    // todo targets.txt), no hosts ni URLs fuera de scope
    expect(readRunFile('nuclei', 'nuclei-in.txt')).toBe('dev.ejemplo.com/login\n')
  })

  it('gate: para ANTES de nuclei sin confirmación; con confirmed sigue y registra el run', async () => {
    makeFullScripts()
    registerBins(ALL_STAGES)
    const rules = { rulesText: 'No automated scanners.' }

    const stopped = await runStages(ALL_STAGES, { rules })
    expect(stopped?.status).toBe('stopped')
    expect(stopped?.needsConfirmation).toBe(true)
    expect(stopped?.stoppedBefore).toBe('nuclei')
    expect(stopped?.stages.find((s) => s.toolId === 'nuclei')?.status).toBe('gate')
    expect(stopped?.stages.find((s) => s.toolId === 'gf')?.status).toBe('done')
    // el gate cortó antes: ni directorio de nuclei existe
    expect(existsSync(path.join(root, project, 'pentest', 'recon', 'nuclei'))).toBe(false)

    const done = await runStages(ALL_STAGES, { rules, confirmed: true })
    expect(done?.status).toBe('done')
    expect(done?.stages.find((s) => s.toolId === 'nuclei')?.status).toBe('done')
  })

  it('una etapa sin resultados → el pipeline PARA con mensaje y no arrastra vacío', async () => {
    makeFullScripts()
    makeScript('dnsx', '') // "ningún registro resuelve"
    registerBins(ALL_STAGES)
    const snap = await runStages(ALL_STAGES, { confirmed: true })

    expect(snap?.status).toBe('stopped')
    expect(snap?.reason).toMatch(/dnsx/i)
    expect(snap?.stages.find((s) => s.toolId === 'subfinder')?.status).toBe('done')
    expect(snap?.stages.find((s) => s.toolId === 'dnsx')?.status).toBe('empty')
    expect(snap?.stages.find((s) => s.toolId === 'httpx')?.status).toBe('skipped')
    expect(snap?.stages.find((s) => s.toolId === 'nuclei')?.status).toBe('skipped')
    expect(existsSync(path.join(root, project, 'pentest', 'recon', 'httpx'))).toBe(false)
  })

  it('fallo de una etapa (exit ≠ 0) → el pipeline no continúa a ciegas', async () => {
    makeFullScripts()
    makeScript('httpx', 'echo boom >&2\nexit 3\n')
    registerBins(ALL_STAGES)
    const snap = await runStages(ALL_STAGES, { confirmed: true })

    expect(snap?.status).toBe('stopped')
    expect(snap?.stages.find((s) => s.toolId === 'httpx')?.status).toBe('error')
    expect(snap?.stages.find((s) => s.toolId === 'katana')?.status).toBe('skipped')
    expect(existsSync(path.join(root, project, 'pentest', 'recon', 'katana'))).toBe(false)
  })

  it('timeout de una etapa → parada sin continuar', async () => {
    makeFullScripts()
    makeScript('katana', 'echo up\nsleep 30\n')
    registerBins(ALL_STAGES)
    const snap = await runStages(ALL_STAGES, { confirmed: true, timeoutMs: 1000 })

    expect(snap?.status).toBe('stopped')
    expect(snap?.stages.find((s) => s.toolId === 'httpx')?.status).toBe('done')
    expect(snap?.stages.find((s) => s.toolId === 'katana')?.status).toBe('error')
    expect(snap?.stages.find((s) => s.toolId === 'katana')?.error).toMatch(/timeout/)
    expect(snap?.stages.find((s) => s.toolId === 'gf')?.status).toBe('skipped')
  })

  it('cancelar a mitad → no arranca etapas posteriores; el estado queda cancelled', async () => {
    makeFullScripts()
    makeScript('katana', 'echo up\nsleep 30\n')
    registerBins(ALL_STAGES)
    const res = startPipeline(
      {
        project,
        scope: ['*.ejemplo.com'],
        rules: { rulesText: 'No automated scanners.' } as never,
        stages: ALL_STAGES,
        confirmed: true,
        timeoutMs: 30_000,
      },
      { runner: new ReconRunner({ root, killGraceMs: 100 }), root },
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return

    // espera a que katana esté en marcha (escribió su salida)
    const katanaDir = path.join(root, project, 'pentest', 'recon', 'katana')
    await waitFor(() => {
      try {
        const dirs = readdirSync(katanaDir)
        const log = dirs.map((d) => path.join(katanaDir, d, 'output.log')).find(existsSync)
        return log && readFileSync(log, 'utf8').includes('up') ? true : undefined
      } catch {
        return undefined
      }
    })

    expect(cancelPipeline(res.pipelineId)).toBe(true)
    const snap = await waitFor(() => {
      const s = getPipeline(res.pipelineId)
      return s && s.status !== 'running' ? s : undefined
    })
    expect(snap?.status).toBe('cancelled')
    expect(snap?.stages.find((s) => s.toolId === 'katana')?.status).toBe('cancelled')
    expect(snap?.stages.find((s) => s.toolId === 'gf')?.status).toBe('skipped')
    expect(snap?.stages.find((s) => s.toolId === 'nuclei')?.status).toBe('skipped')
  })

  it('vía de URLs: sqlmap/dalfox sobre las URLs del scope, con gate y un run por URL', async () => {
    makeScript('sqlmap', 'echo "$*" > sqlmap-args.txt\n')
    makeScript('dalfox', 'echo "$*" > dalfox-args.txt\n')
    registerBins(['sqlmap', 'dalfox'])
    const scope = ['https://app.ejemplo.com/login', 'https://app.ejemplo.com/register']

    const stopped = await runStages(['sqlmap', 'dalfox'], { scope })
    expect(stopped?.needsConfirmation).toBe(true)
    expect(stopped?.stoppedBefore).toBe('sqlmap')
    expect(existsSync(path.join(root, project, 'pentest', 'recon', 'sqlmap'))).toBe(false)

    const snap = await runStages(['sqlmap', 'dalfox'], { scope, confirmed: true })
    expect(snap?.status).toBe('done')
    expect(snap?.stages).toHaveLength(2)
    expect(snap?.stages[0]?.runIds).toHaveLength(2) // un run de sqlmap por URL
    // el ÚLTIMO run (más reciente) corresponde a la segunda URL
    expect(readRunFile('sqlmap', 'sqlmap-args.txt')).toContain('https://app.ejemplo.com/register')
    expect(readRunFile('dalfox', 'dalfox-args.txt')).toContain('https://app.ejemplo.com/register')
  })

  it('host concreto: httpx arranca con el host del scope, sin enumeración previa', async () => {
    makeScript('httpx', 'cat targets.txt > httpx-in.txt\nsed "s|^|https://|" targets.txt\n')
    registerBins(['httpx'])
    const snap = await runStages(['httpx'], { scope: ['api.otro.com'] })
    expect(snap?.status).toBe('done')
    expect(readRunFile('httpx', 'httpx-in.txt')).toBe('api.otro.com\n')
  })

  it('valida las etapas pedidas contra el plan del SERVIDOR (orden, desconocidas, vacío, scope)', () => {
    const badOrder = startPipeline({ project, scope: ['*.ejemplo.com'], stages: ['httpx', 'subfinder'] }, { runner: new ReconRunner({ root }), root })
    expect(badOrder.ok).toBe(false)
    if (!badOrder.ok) expect(badOrder.error).toMatch(/no disponible|fuera de orden|repetida/i)

    const unknown = startPipeline({ project, scope: ['*.ejemplo.com'], stages: ['gau'] }, { runner: new ReconRunner({ root }), root })
    expect(unknown.ok).toBe(false)

    const empty = startPipeline({ project, scope: ['*.ejemplo.com'], stages: [] }, { runner: new ReconRunner({ root }), root })
    expect(empty.ok).toBe(false)

    const noScope = startPipeline({ project, scope: [], stages: ['httpx'] }, { runner: new ReconRunner({ root }), root })
    expect(noScope.ok).toBe(false)
  })
})
