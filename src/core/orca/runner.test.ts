import { describe, expect, it, vi } from 'vitest'
import { runOrcaLaunch, createOrcaWorktreeRun, type ExecImpl } from './runner'
import { classifyOrcaMessage } from './orca'

function makeExec(script: (args: string[]) => Promise<{ stdout: string; stderr?: string; code?: number }>): ExecImpl {
  return async (_bin, args) => {
    const r = await script(args)
    // Fallback: si el script no proporciona una respuesta de `repo list`
    // (ni lista vacía, ni array, ni '{}'), asumimos la carpeta YA
    // registrada para no tocar git en tests que no tratan el registro.
    const isDefault = r.stdout.trim() === '' || r.stdout.trim() === '{}' || !r.stdout.includes('repos')
    if (args[0] === 'repo' && args[1] === 'list' && isDefault) {
      return {
        stdout: JSON.stringify({ ok: true, result: { repos: [{ id: 'r0', path: BASE.repoPath }] } }),
        stderr: '',
        code: 0,
      }
    }
    return { stdout: r.stdout, stderr: r.stderr ?? '', code: r.code ?? 0 }
  }
}

const BASE = {
  bin: '/tmp/orca',
  repoPath: '/repos/demo_project',
  worktreeName: 'demo-pi-1',
  prompt: 'busca XSS en el scope',
}

/** ESTRUCTURA REAL de `orca status --json` (pegada del binario). */
const REAL_STATUS_READY = `{ "ok": true, "result": { "runtime": { "state": "ready",
  "reachable": true }, "app": { "running": true } } }`
const REAL_STATUS_DOWN = `{ "ok": true, "result": { "runtime": { "state": "stopped",
  "reachable": false }, "app": { "running": false } } }`

const statusReady = (reachable: boolean) =>
  reachable ? REAL_STATUS_READY : REAL_STATUS_DOWN

describe('runOrcaLaunch', () => {
  it('status ok (reachable) → salta el open y crea worktree', async () => {
    const calls: string[][] = []
    const exec = makeExec(async (args) => {
      calls.push(args)
      if (args[0] === 'status') return { stdout: statusReady(true) }
      if (args[0] === 'worktree') return { stdout: '{"ok":true,"worktree":{"id":"wt-1","handle":"h-9"},"agentTerminalHandle":"at-3"}' }
      return { stdout: '{}' }
    })
    const out = await runOrcaLaunch(BASE, { execParam: exec, sleepMs: 1, openTimeoutMs: 1000 })
    expect(out.ok).toBe(true)
    expect(out.startedReachable).toBe(true)
    expect(out.opened).toBe(false) // no hizo open
    expect(out.worktreeId).toBe('wt-1')
    expect(out.handle).toBe('h-9')
    expect(out.agentTerminalHandle).toBe('at-3')
    // secuencia: status, worktree (sin open)
    expect(calls.map((c) => c[0])).toEqual(['status', 'repo', 'worktree'])
  })

  it('BUG FIJADO: status listo por stderr (stdout solo logs) → salta open', async () => {
    const calls: string[][] = []
    const exec = makeExec(async (args) => {
      calls.push(args)
      if (args[0] === 'status') {
        // stdout: solo logs/ruido; el JSON real va a stderr
        return { stdout: '[12:00] orca runtime ready\n[12:00] app started', stderr: statusReady(true) + '\n' }
      }
      if (args[0] === 'worktree') return { stdout: '{"ok":true,"worktree":{"id":"wt-9"}}' }
      return { stdout: '{}' }
    })
    const out = await runOrcaLaunch(BASE, { execParam: exec, sleepMs: 1, openTimeoutMs: 1000 })
    expect(out.ok).toBe(true)
    expect(out.startedReachable).toBe(true)
    expect(out.opened).toBe(false) // NUNCA debe intentar open con el runtime ya listo
    expect(calls.map((c) => c[0])).toEqual(['status', 'repo', 'worktree']) // ni un open
  })

  it('status no-reachable → open + espera y luego worktree', async () => {
    const calls: string[][] = []
    let reachable = false
    const exec = makeExec(async (args) => {
      calls.push(args)
      if (args[0] === 'open') { reachable = true; return { stdout: '' } }
      if (args[0] === 'status') return { stdout: statusReady(reachable) }
      if (args[0] === 'worktree') return { stdout: '{"ok":true,"worktree":{"id":"wt-2"}}' }
      return { stdout: '' }
    })
    const out = await runOrcaLaunch(BASE, { execParam: exec, sleepMs: 1, openTimeoutMs: 1000 })
    expect(out.ok).toBe(true)
    expect(out.opened).toBe(true)
    expect(out.startedReachable).toBe(false)
    expect(out.worktreeId).toBe('wt-2')
    expect(calls.some((c) => c[0] === 'open')).toBe(true)
  })

  it('status no-reachable y open no consigue runtime → error claro con timeout', async () => {
    const exec = makeExec(async (args) => {
      if (args[0] === 'status') return { stdout: statusReady(false) }
      return { stdout: '' }
    })
    const out = await runOrcaLaunch(BASE, { execParam: exec, sleepMs: 1, openTimeoutMs: 20 })
    expect(out.ok).toBe(false)
    expect(out.message).toContain('No se pudo abrir Orca')
  })

  it('worktree create ok:false repo_not_found → kind repo_not_found', async () => {
    const exec = makeExec(async (args) => {
      if (args[0] === 'status') return { stdout: statusReady(true) }
      return { stdout: '{"ok":false,"message":"repo_not_found"}' }
    })
    const out = await runOrcaLaunch(BASE, { execParam: exec, sleepMs: 1 })
    expect(out.ok).toBe(false)
    expect(out.kind).toBe('repo_not_found')
  })

  it('worktree create ok:false Unknown TUI agent → kind unknown_agent', async () => {
    const exec = makeExec(async (args) => {
      if (args[0] === 'status') return { stdout: statusReady(true) }
      return { stdout: '{"ok":false,"message":"Unknown TUI agent"}' }
    })
    const out = await runOrcaLaunch(BASE, { execParam: exec, sleepMs: 1 })
    expect(out.ok).toBe(false)
    expect(out.kind).toBe('unknown_agent')
  })

  it('stdout con ruido de stderr/logs → el JSON se parsea igual', async () => {
    const exec = makeExec(async (args) => {
      if (args[0] === 'status') return { stdout: '[log] ' + statusReady(true) + '\n[info] mas logs', stderr: 'warn stuff' }
      return { stdout: '[12:00] log\n{"ok":true,"worktree":{"id":"wt-x","handle":"h-1"},"agentTerminalHandle":"at-2"}\n[info] fin', stderr: '[runtime] warning' }
    })
    const out = await runOrcaLaunch(BASE, { execParam: exec, sleepMs: 1 })
    expect(out.ok).toBe(true)
    expect(out.worktreeId).toBe('wt-x')
    expect(out.handle).toBe('h-1')
  })

  it('el prompt se pasa TAL CUAL a --prompt', async () => {
    const exec = makeExec(async (args) => {
      if (args[0] === 'status') return { stdout: statusReady(true) }
      if (args[0] === 'worktree') return { stdout: '{"ok":true,"worktree":{"id":"w"}}' }
      return { stdout: '' }
    })
    const spy = vi.fn(async (b: string, args: string[]) => {
      const r = await exec(b, args)
      return r
    })
    await runOrcaLaunch(BASE, { execParam: spy, sleepMs: 1 })
    // último call de worktree create: buscar --prompt y su valor
    const worktreeCall = spy.mock.calls.find(([, args]) => args[0] === 'worktree')
    const idx = (worktreeCall?.[1] ?? []).indexOf('--prompt')
    expect(idx).toBeGreaterThan(-1)
    expect(worktreeCall?.[1]?.[idx + 1]).toBe('busca XSS en el scope')
    expect(classifyOrcaMessage(undefined)).toBe('other')
  })
})
describe('runOrcaLaunch · error no-string en worktree create (bug fijado)', () => {
  it('message como OBJETO → no crashea y clasifica correcto (kind repo_not_found)', async () => {
    const exec = makeExec(async (args) => {
      if (args[0] === 'status') return { stdout: statusReady(true) }
      return { stdout: '{"ok":false,"message":{"code":"repo_not_found","msg":"no repo"}}' }
    })
    const out = await runOrcaLaunch(BASE, { execParam: exec, sleepMs: 1, openTimeoutMs: 1000 })
    expect(out.ok).toBe(false)
    expect(out.kind).toBe('repo_not_found')
    expect(typeof out.message).toBe('string')
  })

  it('error anidado result.error.message → el usuario ve la causa REAL', async () => {
    const exec = makeExec(async (args) => {
      if (args[0] === 'status') return { stdout: statusReady(true) }
      return { stdout: '{"ok":false,"result":{"error":{"message":"repo_not_found"}}}' }
    })
    const out = await runOrcaLaunch(BASE, { execParam: exec, sleepMs: 1, openTimeoutMs: 1000 })
    expect(out.ok).toBe(false)
    expect(out.message).toContain('repo_not_found')
    expect(out.kind).toBe('repo_not_found')
  })

  it('message undefined → error genérico legible, sin crash', async () => {
    const exec = makeExec(async (args) => {
      if (args[0] === 'status') return { stdout: statusReady(true) }
      return { stdout: '{"ok":false}' }
    })
    const out = await runOrcaLaunch(BASE, { execParam: exec, sleepMs: 1, openTimeoutMs: 1000 })
    expect(out.ok).toBe(false)
    expect(out.kind).toBe('other')
    expect(typeof out.message).toBe('string')
    expect((out.message ?? '').length).toBeGreaterThan(0)
  })
})

describe('runOrcaLaunch · registro automático de carpeta (git local)', () => {
  const READY = statusReady(true)

  /** orca fake: repo list caduca registrado/lista según arg, repo add ok. */
  function orcaExec(script: (args: string[]) => Promise<{ stdout: string }>) {
    return makeExec(script)
  }

  it('carpeta NO registrada → repo list + git init + repo add + worktree create', async () => {
    const calls: string[][] = []
    let registered = false
    const exec = makeExec(async (args) => {
      calls.push(args)
      if (args[0] === 'status') return { stdout: READY }
      if (args[0] === 'repo' && args[1] === 'list') return { stdout: JSON.stringify({ ok: true, result: { repos: registered ? [{ id: 'r1', path: '/repos/demo_project' }] : [] } }) }
      if (args[0] === 'repo' && args[1] === 'add') { registered = true; return { stdout: JSON.stringify({ ok: true, result: { repo: { id: 'repo-77' } } }) } }
      if (args[0] === 'worktree') return { stdout: '{"ok":true,"worktree":{"id":"wt-9"}}' }
      return { stdout: '{}' }
    })
    // git fake: no es repo al inicio
    let gitRepo = false
    const gitCalls: string[][] = []
    const git: import('./git').GitExec = vi.fn(async (args) => {
      gitCalls.push(args)
      if (args[0] === 'rev-parse') return { stdout: gitRepo ? 'true' : 'false', stderr: '', code: gitRepo ? 0 : 128 }
      if (args[0] === 'init') { gitRepo = true; return { stdout: '', stderr: '', code: 0 } }
      if (args[0] === 'add') return { stdout: '', stderr: '', code: 0 }
      if (args[0] === 'commit') return { stdout: '', stderr: '', code: 0 }
      return { stdout: '', stderr: '', code: 0 }
    })

    const out = await runOrcaLaunch(BASE, { execParam: exec, git, sleepMs: 1, openTimeoutMs: 1000 })
    expect(out.ok).toBe(true)
    expect(out.registered).toBe(true)
    expect(out.registeredNow).toBe(true)
    expect(out.repoId).toBe('repo-77')
    expect(out.worktreeId).toBe('wt-9')
    // secuencia: status, repo list, git init, repo add, worktree
    expect(calls.map((c) => c[0])).toEqual(['status', 'repo', 'repo', 'worktree'])
    expect(gitCalls.some((c) => c[0] === 'init')).toBe(true)
  })

  it('carpeta YA registrada → no repite: sin git init ni repo add, worktree directo', async () => {
    const calls: string[][] = []
    const exec = makeExec(async (args) => {
      calls.push(args)
      if (args[0] === 'status') return { stdout: READY }
      if (args[0] === 'repo' && args[1] === 'list') return { stdout: JSON.stringify({ ok: true, result: { repos: [{ id: 'r1', path: '/repos/demo_project' }] } }) }
      if (args[0] === 'worktree') return { stdout: '{"ok":true,"worktree":{"id":"wt-5"}}' }
      return { stdout: '{}' }
    })
    const gitCalls: string[][] = []
    const git: import('./git').GitExec = vi.fn(async (args) => { gitCalls.push(args); return { stdout: '', stderr: '', code: 0 } })

    const out = await runOrcaLaunch(BASE, { execParam: exec, git, sleepMs: 1 })
    expect(out.ok).toBe(true)
    expect(out.registered).toBe(true)
    expect(out.registeredNow).toBe(false)
    expect(out.worktreeId).toBe('wt-5')
    // sin init ni add: secuencia status → repo list → worktree
    expect(calls.map((c) => c[0])).toEqual(['status', 'repo', 'worktree'])
    expect(gitCalls.some((c) => c[0] === 'init')).toBe(false)
  })

  it('repo add falla → error kind register con la causa real', async () => {
    const exec = makeExec(async (args) => {
      if (args[0] === 'status') return { stdout: READY }
      if (args[0] === 'repo' && args[1] === 'list') return { stdout: JSON.stringify({ ok: true, result: { repos: [] } }) }
      if (args[0] === 'repo' && args[1] === 'add') return { stdout: '{"ok":false,"result":{"error":{"message":"not a git repo"}}}' }
      return { stdout: '{}' }
    })
    const git: import('./git').GitExec = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }))
    const out = await runOrcaLaunch(BASE, { execParam: exec, git, sleepMs: 1 })
    expect(out.ok).toBe(false)
    expect(out.kind).toBe('register')
    expect(out.message).toContain('not a git repo')
  })
})

describe('createOrcaWorktreeRun · multi-proveedor (un worktree por proveedor)', () => {
  it('3 proveedores → 3 worktrees con sus ids de agente mapeados', async () => {
    const calls: { args: string[] }[] = []
    const exec: ExecImpl = async (_b, args) => {
      calls.push({ args })
      return { stdout: '{"ok":true,"worktree":{"id":"wt-' + args[args.indexOf('--agent') + 1] + '"}}', stderr: '', code: 0 }
    }
    const agents = ['pi', 'claude', 'hermes']
    const results = []
    for (const agent of agents) {
      results.push(await createOrcaWorktreeRun(
        { bin: '/x', repoPath: '/r', worktreeName: `p-${agent}-${Date.now()}`, prompt: 'p', agent },
        exec,
      ))
    }
    expect(results.every((r) => r.ok)).toBe(true)
    // ids usados en --agent de cada llamada
    const used = calls.map((c) => c.args[c.args.indexOf('--agent') + 1])
    expect(used).toEqual(agents)
    // worktreeId distinto por llamada (aislamiento)
    expect(new Set(results.map((r) => r.worktreeId)).size).toBe(3)
  })

  it('id de agente inválido (Unknown TUI agent) → falla ese, el resto sigue', async () => {
    const exec: ExecImpl = async (_b, args) => {
      const agent = args[args.indexOf('--agent') + 1]
      if (agent === 'zcode') return { stdout: '{"ok":false,"result":{"error":{"message":"Unknown TUI agent: zcode"}}}', stderr: '', code: 0 }
      return { stdout: '{"ok":true,"worktree":{"id":"wt-' + agent + '"}}', stderr: '', code: 0 }
    }
    const results = []
    for (const agent of ['pi', 'zcode', 'deepseek']) {
      const r = await createOrcaWorktreeRun(
        { bin: '/x', repoPath: '/r', worktreeName: `p-${agent}`, prompt: 'p', agent },
        exec,
      )
      results.push({ agent, ...r })
    }
    // pi y deepseek ok; zcode no
    expect(results[0]!.ok).toBe(true)
    expect(results[1]!.ok).toBe(false)
    expect(results[1]!.kind).toBe('unknown_agent')
    expect(results[2]!.ok).toBe(true)
  })
})
