import { describe, expect, it } from 'vitest'
import {
  classifyOrcaMessage,
  errorText,
  extractJsonBlock,
  isRepoRegistered,
  parseOrcaRepoAdd,
  parseOrcaRepoList,
  parseOrcaStatus,
  parseOrcaWorktree,
} from './orca'

describe('extractJsonBlock (JSON entre ruido de logs/stderr)', () => {
  it('extrae JSON limpio', () => {
    expect(extractJsonBlock('{"ok":true}')).toEqual({ ok: true })
  })

  it('extrae JSON precedido de logs (stdout mezclado)', () => {
    const out = '[12:00] starting agent...\n[12:00] log line\n{"ok":true,"worktree":{"handle":"wt-1"}}\n'
    expect(extractJsonBlock(out)).toEqual({ ok: true, worktree: { handle: 'wt-1' } })
  })

  it('extrae JSON con ruido también DESPUÉS del bloque', () => {
    const out = '{"result":{"runtime":{"reachable":true}}}\n[info] done\nwarning: foo'
    expect(extractJsonBlock(out)).toEqual({ result: { runtime: { reachable: true } } })
  })

  it('ignora llaves dentro de strings', () => {
    const out = '{"msg":"contiene { llaves } dentro","ok":true}'
    expect(extractJsonBlock(out)).toEqual({ msg: 'contiene { llaves } dentro', ok: true })
  })

  it('devuelve null si no hay JSON', () => {
    expect(extractJsonBlock('no json at all')).toBeNull()
    expect(extractJsonBlock('')).toBeNull()
  })

  it('salta bloques malformados y encuentra el bueno', () => {
    const out = '{"incompleto":\n{"ok":true}'
    expect(extractJsonBlock(out)).toEqual({ ok: true })
  })
})

/** ESTRUCTURA REAL de `orca status --json` (pegada del binario). */
const REAL_STATUS_READY = `{ "ok": true, "result": { "runtime": { "state": "ready",
  "reachable": true }, "app": { "running": true } } }`
const REAL_STATUS_DOWN = `{ "ok": true, "result": { "runtime": { "state": "stopped",
  "reachable": false }, "app": { "running": false } } }`

describe('parseOrcaStatus', () => {
  it('ESTRUCTURA REAL: resultado anidado result.runtime.reachable=true → listo', () => {
    expect(parseOrcaStatus(REAL_STATUS_READY)).toEqual({
      runtimeReachable: true,
      runtimeState: 'ready',
      appRunning: true,
    })
  })

  it('ESTRUCTURA REAL: reachable=false → NO listo', () => {
    expect(parseOrcaStatus(REAL_STATUS_DOWN)).toEqual({
      runtimeReachable: false,
      runtimeState: 'stopped',
      appRunning: false,
    })
  })

  it('el campo plano en la raíz (runtimeReachable) NO cuenta — el real está en result.runtime', () => {
    expect(parseOrcaStatus('{"runtimeReachable":true}')).toEqual({ runtimeReachable: false })
    expect(parseOrcaStatus('{"ok":true}')).toEqual({ runtimeReachable: false })
  })

  it('true llega entre logs de stderr (no solo stdout)', () => {
    // stdout lleno de logs y el JSON real en stderr: combinados se lee true
    const stdout = '[12:00] orca runtime ready\n[12:00] app started'
    const stderr = '[gpu] init ok\n' + REAL_STATUS_READY + '\n'
    expect(parseOrcaStatus(stdout + '\n' + stderr).runtimeReachable).toBe(true)
  })

  it('false si no llega nada parseable', () => {
    expect(parseOrcaStatus('nada')).toEqual({ runtimeReachable: false })
  })
})

describe('parseOrcaWorktree', () => {
  it('ok:true extrae handle, agentTerminalHandle y worktreeId', () => {
    const out = '[log]\n{"ok":true,"worktree":{"id":"wt-42","handle":"h-7"},"agentTerminalHandle":"at-9","worktreeId":"wt-42"}'
    const r = parseOrcaWorktree(out)
    expect(r.ok).toBe(true)
    expect(r.handle).toBe('h-7')
    expect(r.agentTerminalHandle).toBe('at-9')
    expect(r.worktreeId).toBe('wt-42')
  })

  it('ok:false con repo_not_found', () => {
    const r = parseOrcaWorktree('{"ok":false,"message":"repo_not_found: no repo registered"}')
    expect(r.ok).toBe(false)
    expect(r.message).toContain('repo_not_found')
    expect(classifyOrcaMessage(r.message)).toBe('repo_not_found')
  })

  it('ok:false con Unknown TUI agent', () => {
    const r = parseOrcaWorktree('{"ok":false,"message":"Unknown TUI agent: foo"}')
    expect(r.ok).toBe(false)
    expect(classifyOrcaMessage(r.message)).toBe('unknown_agent')
  })

  it('ok:false genérico', () => {
    const r = parseOrcaWorktree('{"ok":false,"message":"fallo raro"}')
    expect(classifyOrcaMessage(r.message)).toBe('other')
  })

  it('BUG FIJADO: message NO string (objeto) no crashea y se serializa', () => {
    // message como objeto: antaño j.message?.toLowerCase() → TypeError
    const r = parseOrcaWorktree('{"ok":false,"message":{"code":"repo_not_found","detail":"no repo"}}')
    expect(r.ok).toBe(false)
    expect(typeof r.message).toBe('string')
    expect(r.message).toContain('repo_not_found')
    expect(classifyOrcaMessage(r.message)).toBe('repo_not_found')
  })

  it('message undefined → error genérico legible, sin crash', () => {
    const r = parseOrcaWorktree('{"ok":false}')
    expect(r.ok).toBe(false)
    expect(typeof r.message).toBe('string')
    expect(r.message?.length ?? 0).toBeGreaterThan(0)
    expect(classifyOrcaMessage(r.message)).toBe('other')
  })

  it('result.error.message (anidado) → se extrae el texto real', () => {
    const r = parseOrcaWorktree('{"ok":false,"result":{"error":{"message":"repo_not_found"}}}')
    expect(r.message).toBe('repo_not_found')
    expect(classifyOrcaMessage(r.message)).toBe('repo_not_found')
  })

  it('result.error como OBJETO sin .message → se serializa (no crashea)', () => {
    const r = parseOrcaWorktree('{"ok":false,"result":{"error":{"code":"E_UNKNOWN"}}}')
    expect(r.ok).toBe(false)
    expect(typeof r.message).toBe('string')
    expect(r.message).toContain('E_UNKNOWN')
    expect(classifyOrcaMessage(r.message)).toBe('other')
  })

  it('result.message (string) → se lee', () => {
    const r = parseOrcaWorktree('{"ok":false,"result":{"message":"Unknown TUI agent: pi"}}')
    expect(r.message).toBe('Unknown TUI agent: pi')
    expect(classifyOrcaMessage(r.message)).toBe('unknown_agent')
  })

  it('stdout sin JSON → ok:false genérico', () => {
    const r = parseOrcaWorktree('nothing here')
    expect(r.ok).toBe(false)
  })
})

describe('parseOrcaRepoList / isRepoRegistered / parseOrcaRepoAdd', () => {
  it('repo list devuelve repos y encuentra el path', () => {
    const out = '{"ok":true,"result":{"repos":[{"id":"r1","path":"/repos/a"},{"id":"r2","path":"/repos/demo_project"}]}}'
    const list = parseOrcaRepoList(out)
    expect(list.ok).toBe(true)
    expect(list.repos).toHaveLength(2)
    expect(isRepoRegistered(list.repos, '/repos/demo_project')).toBe(true)
    expect(isRepoRegistered(list.repos, '/repos/no-existe')).toBe(false)
  })

  it('repo list tolera el array en la raíz y paths con barra final', () => {
    const out = '{"repos":[{"path":"/repos/demo_project/"}]}'
    const list = parseOrcaRepoList(out)
    expect(isRepoRegistered(list.repos, '/repos/demo_project')).toBe(true)
  })

  it('repo list sin array → no registrado, ok según campo', () => {
    expect(parseOrcaRepoList('{"ok":true}').repos).toEqual([])
    expect(isRepoRegistered([], '/x')).toBe(false)
  })

  it('repo add extrae id/repoId', () => {
    const out = '{"ok":true,"result":{"repo":{"id":"repo-42"}}}'
    expect(parseOrcaRepoAdd(out).id).toBe('repo-42')
  })
})
