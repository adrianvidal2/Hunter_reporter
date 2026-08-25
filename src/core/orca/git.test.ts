import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { ensureGitRepo, isGitRepo, type GitExec } from './git'

const root = mkdtempSync(join(tmpdir(), 'orca-git-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** GitExec falso: script sobre args; estado compartido para simular repo. */
function makeGit(
  script: (args: string[], state: { isRepo: boolean; userName?: string; userEmail?: string }) => void,
): GitExec {
  const state: { isRepo: boolean; userName?: string; userEmail?: string } = { isRepo: false }
  const fn = vi.fn(async (args: string[], _cwd?: string) => {
    script(args, state)
    if (args[0] === 'rev-parse') {
      return { stdout: state.isRepo ? 'true' : 'false', stderr: '', code: state.isRepo ? 0 : 128 }
    }
    if (args[0] === 'init') { state.isRepo = true; return { stdout: 'ok', stderr: '', code: 0 } }
    if (args[0] === 'config' && args[1] === '--get') {
      const v = args[2] === 'user.name' ? state.userName : state.userEmail
      return { stdout: v ?? '', stderr: '', code: v ? 0 : 1 }
    }
    if (args[0] === 'add' || args[0] === 'commit') return { stdout: '', stderr: '', code: 0 }
    return { stdout: '', stderr: '', code: 0 }
  }) as GitExec
  return fn
}

describe('ensureGitRepo (git local del proyecto, idempotente)', () => {
  it('carpeta SIN git → init + config dummy + add + commit', async () => {
    const calls: string[][] = []
    const git = makeGit((args) => { calls.push(args) })
    const dir = join(root, 'demo_project')
    const r = await ensureGitRepo(dir, { git })
    expect(r.initialized).toBe(true)
    const initIdx = calls.findIndex((c) => c[0] === 'init')
    const addIdx = calls.findIndex((c) => c[0] === 'add')
    const commitIdx = calls.findIndex((c) => c[0] === 'commit')
    expect(initIdx).toBeGreaterThan(-1)
    expect(addIdx).toBeGreaterThan(initIdx)
    expect(commitIdx).toBeGreaterThan(addIdx)
    // config dummy se aplicó
    expect(calls.some((c) => c[0] === 'config' && c[1] === 'user.name' && c[2] === 'reporter')).toBe(true)
  })

  it('IDEMPOTENTE: si ya es repo git, NO repite init', async () => {
    const calls: string[][] = []
    const git = makeGit((args) => { calls.push(args) })
    const dir = join(root, 'ya-git')
    await ensureGitRepo(dir, { git })
    calls.length = 0
    const r2 = await ensureGitRepo(dir, { git })
    expect(r2.initialized).toBe(false)
    expect(calls.some((c) => c[0] === 'init')).toBe(false)
  })

  it('pentest/ se añade al .gitignore local del proyecto (sin pisar el existente)', async () => {
    const dir = join(root, 'con-gitignore')
    // .gitignore previo del proyecto con otro contenido
    const { mkdirSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '.gitignore'), 'reports/\n')
    const git = makeGit(() => {})
    await ensureGitRepo(dir, { git })
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(gi).toContain('reports/') // respetado
    expect(gi).toContain('pentest/') // credenciales no se comitean
  })

  it('isGitRepo detecta repo vs no-repo', async () => {
    const fresh = makeGit(() => {})
    expect(await isGitRepo('/x', fresh)).toBe(false)
    const withRepo = makeGit((args, s) => { if (args[0] === 'rev-parse') s.isRepo = true })
    await withRepo(['rev-parse', '--is-inside-work-tree'], '/x')
    expect(await isGitRepo('/x', withRepo)).toBe(true)
  })
})