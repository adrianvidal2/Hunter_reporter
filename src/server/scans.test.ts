import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ REPORTS_ROOT: env.root }) }))
vi.mock('@/core/orca/settings', () => ({ loadOrcaSettings: () => ({ orcaBin: '/tmp/orca' }) }))

import { buildScansView, terminalHandleFor } from './scans'
import type { ExecScan } from './scans'

const root = mkdtempSync(join(tmpdir(), 'scans-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function writeLaunch(project: string, rec: Record<string, unknown>) {
  const dir = join(root, project, 'pentest')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'launches.json')
  let cur: { launches: unknown[] } = { launches: [] }
  try {
    cur = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // no existe aún
  }
  cur.launches.push(rec)
  writeFileSync(file, JSON.stringify(cur, null, 2))
}

describe('buildScansView (estado EN VIVO, nunca cacheado)', () => {
  beforeEach(() => {
    const { rmSync } = require('node:fs')
    try { rmSync(root, { recursive: true }); } catch {}
    mkdirSync(root, { recursive: true })
    env.root = root
  })

  const NOW = 1_780_000_000_000

  it('UNA FILA POR AGENTE con label y prompt inicial visibles (2 pi + 1 hermes)', async () => {
    writeLaunch('demo_project', { timestamp: NOW - 60_000, provider: 'pi', mode: 'orca', ok: true, label: 'Pi #1', prompt: 'prompt A', worktreeId: 'wt-1', agentTerminalHandle: 'at-1' })
    writeLaunch('demo_project', { timestamp: NOW - 60_000, provider: 'pi', mode: 'orca', ok: true, label: 'Pi #2', prompt: 'prompt B', worktreeId: 'wt-2', agentTerminalHandle: 'at-2' })
    writeLaunch('demo_project', { timestamp: NOW - 60_000, provider: 'hermes', mode: 'orca', ok: true, label: 'Hermes #1', prompt: 'prompt C', worktreeId: 'wt-3', agentTerminalHandle: 'at-3' })
    const exec: ExecScan = async () => ({ stdout: '{"ok":true,"result":{"terminals":[]}}', stderr: '', code: 0 })
    const view = await buildScansView(root, { exec, nowMs: NOW })
    expect(view.rows).toHaveLength(3)
    const byLabel = Object.fromEntries(view.rows.map((r) => [r.label, r]))
    expect(byLabel['Pi #1']!.prompt).toBe('prompt A')
    expect(byLabel['Pi #2']!.prompt).toBe('prompt B')
    expect(byLabel['Hermes #1']!.prompt).toBe('prompt C')
    expect(byLabel['Pi #1']!.provider).toBe('pi')
  })

  it('launch fallido (ok:false) → fila con Error de lanzamiento, no estado en vivo', async () => {
    writeLaunch('demo_project', { timestamp: NOW, provider: 'zcode', mode: 'orca', ok: false, label: 'Zcode #1', prompt: 'p', error: 'id de agente no válido en Orca' })
    const exec: ExecScan = async () => ({ stdout: '{"ok":true,"result":{"terminals":[]}}', stderr: '', code: 0 })
    const view = await buildScansView(root, { exec, nowMs: NOW })
    expect(view.rows).toHaveLength(1)
    expect(view.rows[0]!.launchOk).toBe(false)
    expect(view.rows[0]!.statusLabel).toBe('Error de lanzamiento')
    expect(view.rows[0]!.launchError).toContain('id de agente no válido')
  })

  it('handle presente + lastOutputAt reciente → Activa (consulta en vivo al abrir)', async () => {
    writeLaunch('demo_project', { timestamp: NOW - 60_000, provider: 'pi', mode: 'orca', ok: true, label: 'Pi #1', worktreeId: 'wt-1', agentTerminalHandle: 'at-1' })
    const exec: ExecScan = async () => ({
      stdout: '{"ok":true,"result":{"terminals":[{"handle":"at-1","connected":true,"orphaned":false,"lastOutputAt":' + (NOW - 5_000) + ',"title":"Pi ready"}]}}\n',
      stderr: '',
      code: 0,
    })
    const view = await buildScansView(root, { exec, nowMs: NOW })
    expect(view.rows).toHaveLength(1)
    expect(view.rows[0]!.status).toBe('active')
    expect(view.rows[0]!.statusLabel).toBe('Activa')
    expect(view.rows[0]!.title).toBe('Pi ready')
  })

  it('handle AUSENTE en terminal list → Sesión cerrada (no error)', async () => {
    writeLaunch('demo_project', { timestamp: NOW - 60_000, provider: 'claude', mode: 'orca', ok: true, label: 'Claude #1', agentTerminalHandle: 'at-ausente' })
    const exec: ExecScan = async () => ({ stdout: '{"ok":true,"result":{"terminals":[]}}', stderr: '', code: 0 })
    const view = await buildScansView(root, { exec, nowMs: NOW })
    expect(view.rows[0]!.status).toBe('closed')
    expect(view.rows[0]!.statusLabel).toBe('Sesión cerrada')
  })

  it('orphaned:true → Muerta; antiguo conectado → Ociosa', async () => {
    writeLaunch('p1', { timestamp: 1, provider: 'pi', mode: 'orca', ok: true, label: 'Pi #1', agentTerminalHandle: 'at-dead' })
    writeLaunch('p1', { timestamp: 2, provider: 'claude', mode: 'orca', ok: true, label: 'Claude #1', agentTerminalHandle: 'at-idle' })
    const exec: ExecScan = async () => ({
      stdout: '{"result":{"terminals":[{"handle":"at-dead","connected":true,"orphaned":true,"lastOutputAt":' + (NOW - 1_000) + '},{"handle":"at-idle","connected":true,"orphaned":false,"lastOutputAt":' + (NOW - 300_000) + '}]}}',
      stderr: '',
      code: 0,
    })
    const view = await buildScansView(root, { exec, nowMs: NOW })
    const byHandle = Object.fromEntries(view.rows.map((r) => [r.handle, r.status]))
    expect(byHandle['at-dead']).toBe('dead')
    expect(byHandle['at-idle']).toBe('idle')
  })

  it('parseo entre ruido de logs (stdout+stderr combinado)', async () => {
    writeLaunch('p2', { timestamp: 1, provider: 'hermes', mode: 'orca', ok: true, label: 'Hermes #1', agentTerminalHandle: 'at-r' })
    const exec: ExecScan = async () => ({
      stdout: '[12:00] log line\n',
      stderr: 'warning\n{"ok":true,"result":{"terminals":[{"handle":"at-r","connected":true,"lastOutputAt":' + (NOW - 2_000) + '}]}}\n',
      code: 0,
    })
    const view = await buildScansView(root, { exec, nowMs: NOW })
    expect(view.rows[0]!.status).toBe('active') // JSON venía por stderr
  })

  it('VISTA GLOBAL agrega todos los proyectos; VISTA POR PROYECTO filtra', async () => {
    writeLaunch('proyA', { timestamp: 1, provider: 'pi', mode: 'orca', ok: true, label: 'Pi #1', agentTerminalHandle: 'at-a' })
    writeLaunch('proyB', { timestamp: 2, provider: 'claude', mode: 'orca', ok: true, label: 'Claude #1', agentTerminalHandle: 'at-b' })
    const exec: ExecScan = async () => ({ stdout: '{"ok":true,"result":{"terminals":[]}}', stderr: '', code: 0 })
    const global = await buildScansView(root, { exec, nowMs: NOW })
    expect(global.rows.map((r) => r.project).sort()).toEqual(['proyA', 'proyB'])
    const only = await buildScansView(root, { exec, nowMs: NOW, project: 'proyA' })
    expect(only.rows).toHaveLength(1)
    expect(only.rows[0]!.project).toBe('proyA')
    expect(only.rows[0]!.label).toBe('Pi #1')
  })

  it('terminalHandleFor: agentTerminalHandle tiene prioridad sobre handle', () => {
    expect(terminalHandleFor({ agentTerminalHandle: 'at-1', handle: 'h-1' } as never)).toBe('at-1')
    expect(terminalHandleFor({ handle: 'h-1' } as never)).toBe('h-1')
    expect(terminalHandleFor({} as never)).toBeUndefined()
  })
})