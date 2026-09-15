import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { saveReconSettings } from '@/core/recon/settings'
import { ReconRunner, type ReconEvent } from './recon-runner'

let root: string
let binDir: string
const created: string[] = []

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'recon-runner-'))
  binDir = path.join(root, 'bin')
  mkdirSync(binDir, { recursive: true })
  mkdirSync(path.join(root, 'demo', 'reportes'), { recursive: true })
  // Ajustes de recon: settingsDir() = cwd/.settings
  process.chdir(mkdtempSync(path.join(tmpdir(), 'recon-settings-')))
})

afterAll(() => {
  for (const p of created) rmSync(p, { recursive: true, force: true })
})

/** Script ejecutable de prueba (bash con shebang: lo lanza execFile directo). */
function makeScript(name: string, body: string): string {
  const p = path.join(binDir, name)
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(p, 0o755)
  return p
}

/** Spy de spawn que registra las opciones EXACTAS con las que se spawnea. */
interface RecordedCall { file: string; args: string[]; options: Record<string, unknown> }
function makeSpy() {
  const calls: RecordedCall[] = []
  const impl: typeof spawn = ((file: string, args: string[], options: Parameters<typeof spawn>[2]) => {
    calls.push({ file, args, options: options as unknown as Record<string, unknown> })
    return spawn(file, args, options)
  }) as unknown as typeof spawn
  return { calls, impl }
}

async function waitFor<T>(fn: () => T | undefined, ms = 5000): Promise<T> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = fn()
    if (v !== undefined) return v
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('timeout esperando condición')
}

function newRunner(extra: Record<string, unknown> = {}): { runner: ReconRunner; spy: ReturnType<typeof makeSpy> } {
  const spy = makeSpy()
  const runner = new ReconRunner({ root, spawnImpl: spy.impl, killGraceMs: 150, ...extra })
  return { runner, spy }
}

const UA = 'Programa-Ejemplo-UA'

beforeEach(() => {
  saveReconSettings({ binPaths: {} })
})

describe('ReconRunner · gate de reglas (tres estados)', () => {
  it('texto que prohíbe y sin confirmación → needsConfirmation y NADA se lanza', () => {
    const { runner, spy } = newRunner()
    const res = runner.start({
      project: 'demo', toolId: 'nuclei', targets: ['api.ejemplo.com'], scope: ['api.ejemplo.com'],
      rules: { rulesText: 'No automated scanners.' }, timeoutMs: 2000,
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.needsConfirmation).toBe(true)
    expect(res.verdict?.state).toBe('prohibited')
    expect(spy.calls).toHaveLength(0) // nada de binarios
    expect(existsSync(path.join(root, 'demo', 'pentest', 'recon'))).toBe(false) // ni directorio
  })

  it('misma petición con confirmed:true → lanza; confirmación queda en run.json', async () => {
    const echo = makeScript('nuclei', 'echo escaneando')
    saveReconSettings({ binPaths: { nuclei: echo } })
    const { runner } = newRunner()
    const res = runner.start({
      project: 'demo', toolId: 'nuclei', targets: ['api.ejemplo.com'], scope: ['api.ejemplo.com'],
      rules: { rulesText: 'No automated scanners.' }, confirmed: true, timeoutMs: 5000,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const run = await waitFor(() => {
      const r = runner.getRun(res.ok ? res.runId : '')
      return r && r.status !== 'running' ? r : undefined
    })
    expect(run.status).toBe('done')
    expect(run.confirmedByUser).toBe(true)
    expect(run.rules.state).toBe('prohibited')
  })

  it('autorización EXPLÍCITA en las reglas → sin gate, lanza directo', async () => {
    const echo = makeScript('ffuf', 'echo fuzz')
    saveReconSettings({ binPaths: { ffuf: echo } })
    const { runner, spy } = newRunner()
    const res = runner.start({
      project: 'demo', toolId: 'ffuf', targets: ['api.ejemplo.com'], scope: ['api.ejemplo.com'],
      rules: { rulesText: 'Automated scanning is allowed and encouraged.' }, userAgent: UA, timeoutMs: 5000,
    })
    expect(res.ok).toBe(true)
    if (res.ok) await waitFor(() => (runner.getRun(res.runId)?.status === 'done' ? true : undefined))
    expect(spy.calls).toHaveLength(1) // lanzó directo, sin pedir confirmación
  })
})

describe('ReconRunner · execFile seguro', () => {
  it('shell:false + detached en TODAS las ejecuciones; args = array exacto de la receta', async () => {
    const subf = makeScript('subfinder', 'cat targets.txt 2>/dev/null; echo subfinder-ok')
    saveReconSettings({ binPaths: { subfinder: subf } })
    const { runner, spy } = newRunner()
    const res = runner.start({
      project: 'demo', toolId: 'subfinder', targets: ['*.ejemplo.com'], scope: ['*.ejemplo.com'],
      timeoutMs: 5000,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    await waitFor(() => runner.getRun(res.ok ? res.runId : ''))
    expect(spy.calls).toHaveLength(1)
    expect(spy.calls[0]!.options).toMatchObject({ shell: false, detached: true })
    // receta subfinder: dominio BASE sin `*.` vía targets.txt
    expect(spy.calls[0]!.args).toEqual(['-dL', expect.stringContaining('targets.txt'), '-silent'])
  })

  it('intersección: target fuera de scope → error con motivos, cero ejecuciones', () => {
    const { runner, spy } = newRunner()
    const res = runner.start({
      project: 'demo', toolId: 'httpx', targets: ['fuera.com'], scope: ['api.ejemplo.com'],
      timeoutMs: 2000,
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.rejected).toEqual([{ target: 'fuera.com', reason: 'out_of_scope' }])
    expect(spy.calls).toHaveLength(0)
  })
})

describe('ReconRunner · ciclo de vida', () => {
  it('run correcto: done, exitCode 0, output.log con stdout y cabecera', async () => {
    makeScript('httpx', 'echo hola-recon')
    saveReconSettings({ binPaths: { httpx: path.join(binDir, 'httpx') } })
    const { runner } = newRunner()
    const res = runner.start({
      project: 'demo', toolId: 'httpx', targets: ['api.ejemplo.com'], scope: ['api.ejemplo.com'],
      userAgent: UA, timeoutMs: 5000,
    })
    if (!res.ok) console.log('START FAILED:', JSON.stringify(res))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const run = await waitFor(() => {
      const r = runner.getRun(res.runId)
      return r && r.status !== 'running' ? r : undefined
    })
    expect(run.status).toBe('done')
    expect(run.exitCode).toBe(0)
    expect(run.binary.size).toBeGreaterThan(0) // traza del binario concreto
    expect(run.uaInjected).toBe(true)
    const log = readFileSync(path.join(root, res.outputDir, 'output.log'), 'utf8')
    expect(log).toContain('hola-recon')
    expect(log).toMatch(/^\$ .+httpx /m) // cabecera con comando exacto
  })

  it('stdin: gau recibe los targets por stdin', async () => {
    makeScript('gau', 'while read -r l; do echo "got:$l"; done')
    saveReconSettings({ binPaths: { gau: path.join(binDir, 'gau') } })
    const { runner } = newRunner()
    const res = runner.start({
      project: 'demo', toolId: 'gau', targets: ['api.ejemplo.com'], scope: ['api.ejemplo.com'], timeoutMs: 5000,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    await waitFor(() => {
      const r = runner.getRun(res.ok ? res.runId : '')
      return r && r.status !== 'running' ? true : undefined
    })
    const log = readFileSync(path.join(root, res.outputDir, 'output.log'), 'utf8')
    expect(log).toContain('got:api.ejemplo.com')
  })

  it('timeout → SIGTERM al GRUPO, gracia y SIGKILL: el proceso y sus HIJOS mueren', async () => {
    // el script deja un hijo (sleep) vivo en su grupo y escribe su pid
    makeScript('nmap', 'sleep 30 &\necho $! > child.pid\necho up\nwait')
    saveReconSettings({ binPaths: { nmap: path.join(binDir, 'nmap') } })
    const { runner } = newRunner()
    const res = runner.start({
      project: 'demo', toolId: 'nmap', targets: ['api.ejemplo.com'], scope: ['api.ejemplo.com'],
      confirmed: true, // el gate (silent → confirmar) se prueba en su bloque
      timeoutMs: 300,
    })
    if (!res.ok) console.log('NMAP START FAILED:', JSON.stringify(res))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const run = await waitFor(() => {
      const r = runner.getRun(res.ok ? res.runId : '')
      return r?.status === 'timeout' ? r : undefined
    })
    // hijo dormido: pid escrito por el script en el outputDir
    const childPid = Number(readFileSync(path.join(root, res.outputDir, 'child.pid'), 'utf8').trim())
    // tras la gracia, binario e hijo (mismo grupo) están muertos
    await new Promise((r) => setTimeout(r, 400))
    expect(() => process.kill(childPid, 0)).toThrow()
    expect(() => process.kill(run.pid!, 0)).toThrow()
  })

  it('cancel() → SIGTERM+escalado, estado cancelled y pid muerto', async () => {
    makeScript('katana', 'echo up\nsleep 30')
    saveReconSettings({ binPaths: { katana: path.join(binDir, 'katana') } })
    const { runner } = newRunner()
    const res = runner.start({
      project: 'demo', toolId: 'katana', targets: ['api.ejemplo.com'], scope: ['api.ejemplo.com'], timeoutMs: 30_000,
    })
    if (!res.ok) console.log('KATANA START FAILED:', JSON.stringify(res))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const pid = await waitFor(() => {
      const p = runner.getRun(res.runId)?.pid
      return typeof p === 'number' ? p : undefined
    })
    await waitFor(() => {
      try {
        return readFileSync(path.join(root, res.outputDir, 'output.log'), 'utf8').includes('up') ? true : undefined
      } catch {
        return undefined
      }
    })
    expect(runner.cancel(res.ok ? res.runId : '')).toBe(true)
    const run = await waitFor(() => {
      const r = runner.getRun(res.ok ? res.runId : '')
      return r?.status === 'cancelled' ? r : undefined
    })
    expect(run.status).toBe('cancelled')
    await new Promise((r) => setTimeout(r, 350))
    expect(() => process.kill(pid, 0)).toThrow()
  })

  it('streaming: los suscriptores reciben los chunks de salida', async () => {
    makeScript('dnsx', 'echo chunk-streaming')
    saveReconSettings({ binPaths: { dnsx: path.join(binDir, 'dnsx') } })
    const { runner } = newRunner()
    const events: ReconEvent[] = []
    runner.subscribe((e) => events.push(e))
    const res = runner.start({
      project: 'demo', toolId: 'dnsx', targets: ['api.ejemplo.com'], scope: ['api.ejemplo.com'], timeoutMs: 5000,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    await waitFor(() => {
      const r = runner.getRun(res.ok ? res.runId : '')
      return r === null || r.status === 'done' ? true : undefined
    })
    expect(events.some((e) => e.type === 'recon-output' && e.chunk?.includes('chunk-streaming'))).toBe(true)
  })
})

describe('ReconRunner · huérfanos al reiniciar el servidor', () => {
  it('run.json running con pid VIVO → orphaned; pid MUERTO → interrupted; nada se mata solo', () => {
    const dir = path.join(root, 'demo', 'pentest', 'recon', 'nuclei', '20260905-000001')
    mkdirSync(dir, { recursive: true })
    const base = {
      runId: 'nuclei-1', project: 'demo', toolId: 'nuclei', binPath: '/bin/true',
      binary: { size: 1, mtimeMs: 1 }, commands: [], targets: [], rejected: [],
      uaInjected: false, warnings: [], rules: { state: 'silent', reason: 'x' },
      confirmedByUser: false, startedAt: new Date().toISOString(), timeoutMs: 30_000,
    }
    // pid vivo: el propio proceso de test
    writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ ...base, status: 'running', pid: process.pid }, null, 2))
    // pid muerto: spawnSync ya ha terminado cuando devuelve
    const deadPid = spawnSync('true').pid!

    const dir2 = path.join(root, 'demo', 'pentest', 'recon', 'nuclei', '20260905-000002')
    mkdirSync(dir2, { recursive: true })
    writeFileSync(path.join(dir2, 'run.json'), JSON.stringify({ ...base, runId: 'nuclei-2', status: 'running', pid: deadPid }, null, 2))

    const { runner } = newRunner()
    const res = runner.recoverOrphans()
    expect(res.orphaned).toContain('nuclei-1')
    expect(res.interrupted).toContain('nuclei-2')
    const r1 = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'))
    const r2 = JSON.parse(readFileSync(path.join(dir2, 'run.json'), 'utf8'))
    expect(r1.status).toBe('orphaned')
    expect(r2.status).toBe('interrupted')
    // el pid vivo SIGUE vivo: nada se mata solo
    expect(() => process.kill(process.pid, 0)).not.toThrow()
  })

  it('killOrphan mata SOLO el proceso del run.json en estado orphaned, con acción explícita', async () => {
    const dir = path.join(root, 'demo', 'pentest', 'recon', 'nuclei', '20260905-000003')
    mkdirSync(dir, { recursive: true })
    // proceso dormidero REAL como huérfano (nunca el worker del test)
    const sleeper = spawn('sleep', ['30'])
    const record = {
      runId: 'nuclei-3', project: 'demo', toolId: 'nuclei', binPath: '/bin/true',
      binary: { size: 1, mtimeMs: 1 }, commands: [], targets: [], rejected: [],
      uaInjected: false, warnings: [], rules: { state: 'silent', reason: 'x' },
      confirmedByUser: false, status: 'running', startedAt: new Date().toISOString(),
      timeoutMs: 30_000, pid: sleeper.pid,
    }
    writeFileSync(path.join(dir, 'run.json'), JSON.stringify(record, null, 2))
    const { runner } = newRunner()
    expect(runner.recoverOrphans().orphaned).toContain('nuclei-3')
    expect(runner.killOrphan(path.join(dir, 'run.json'))).toBe(true)
    const after = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'))
    expect(after.status).toBe('cancelled')
    // el dormidero murió; el worker del test sigue vivo
    await new Promise((r) => setTimeout(r, 100))
    expect(() => process.kill(sleeper.pid!, 0)).toThrow()
    expect(() => process.kill(process.pid, 0)).not.toThrow()
  })
})


describe('pid reciclado (starttime contrastado)', () => {
  it('pid vivo pero starttime DISTINTO (reciclado) → interrupted, y killOrphan NO dispara', async () => {
    const dir = path.join(root, 'demo', 'pentest', 'recon', 'nuclei', '20260905-000004')
    mkdirSync(dir, { recursive: true })
    const sleeper = spawn('sleep', ['30'])
    const record = {
      runId: 'nuclei-4', project: 'demo', toolId: 'nuclei', binPath: '/bin/true',
      binary: { size: 1, mtimeMs: 1 }, commands: [], targets: [], rejected: [],
      uaInjected: false, warnings: [], rules: { state: 'silent', reason: 'x' },
      confirmedByUser: false, status: 'running', startedAt: new Date().toISOString(),
      timeoutMs: 30_000, pid: sleeper.pid,
      procStartTime: 999999999, // starttime que NO puede coincidir con el real
    }
    writeFileSync(path.join(dir, 'run.json'), JSON.stringify(record, null, 2))
    const { runner } = newRunner()
    // el pid está vivo pero el starttime no coincide → NO es huérfano nuestro
    const recovery = runner.recoverOrphans()
    expect(recovery.orphaned).not.toContain('nuclei-4')
    expect(recovery.interrupted).toContain('nuclei-4')
    expect(runner.killOrphan(path.join(dir, 'run.json'))).toBe(false)
    // el proceso ajeno sigue vivo: no se envió señal
    expect(() => process.kill(sleeper.pid!, 0)).not.toThrow()
    const after = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'))
    expect(after.status).toBe('interrupted')
    runner.killOrphan // (cobertura del guard)
    try { process.kill(sleeper.pid!, 'SIGKILL') } catch { /* limpieza */ }
  })

  it('run.json registra procStartTime al lanzar', async () => {
    makeScript('nmap', 'echo ok')
    saveReconSettings({ binPaths: { nmap: path.join(binDir, 'nmap') } })
    const { runner } = newRunner()
    const res = runner.start({
      project: 'demo', toolId: 'nmap', targets: ['api.ejemplo.com'], scope: ['api.ejemplo.com'],
      confirmed: true, timeoutMs: 5000,
    })
    expect(res.ok).toBe(true)
    await waitFor(() => {
      const r = runner.getRun(res.ok ? res.runId : '')
      return r && r.status !== 'running' ? r : undefined
    })
    const run = runner.getRun(res.ok ? res.runId : '')
    expect(run?.procStartTime).toBeGreaterThan(0)
  })
})
