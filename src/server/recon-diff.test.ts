import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { diffLatestReconRuns } from './recon-diff'

const root = mkdtempSync(join(tmpdir(), 'recon-diff-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** Crea un run de una herramienta con su output.log. */
function writeRun(project: string, toolId: string, dirName: string, output: string): void {
  const dir = join(root, project, 'pentest', 'recon', toolId, dirName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'output.log'), output)
}

describe('diffLatestReconRuns (dos runs más recientes)', () => {
  it('compara los dos últimos y resalta lo nuevo', () => {
    writeRun('demo', 'subfinder', '20260101-100000', 'a.ejemplo.com\nb.ejemplo.com\n')
    writeRun('demo', 'subfinder', '20260102-100000', 'b.ejemplo.com\nc.ejemplo.com\n')
    writeRun('demo', 'subfinder', '20260103-100000', 'b.ejemplo.com\nc.ejemplo.com\nd.ejemplo.com\n')

    const res = diffLatestReconRuns('demo', 'subfinder', root)
    expect(res.ok).toBe(true)
    // los dos MÁS recientes: 0102 (anterior) vs 0103 (actual)
    expect(res.previous?.dirName).toBe('20260102-100000')
    expect(res.current?.dirName).toBe('20260103-100000')
    expect(res.diff).toEqual({
      added: ['d.ejemplo.com'],
      removed: [],
      unchanged: ['b.ejemplo.com', 'c.ejemplo.com'],
    })
  })

  it('un solo run: no hay con qué comparar', () => {
    writeRun('solo', 'httpx', '20260101-100000', 'https://x.com\n')
    const res = diffLatestReconRuns('solo', 'httpx', root)
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/dos runs/i)
  })

  it('sin runs de la herramienta: lo dice', () => {
    const res = diffLatestReconRuns('demo', 'httpx', root)
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/sin runs/i)
  })

  it('herramienta no diffeable (nmap): lo dice sin leer disco', () => {
    const res = diffLatestReconRuns('demo', 'nmap', root)
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/comparable/i)
  })

  it('herramienta fuera de la lista blanca', () => {
    const res = diffLatestReconRuns('demo', 'rm-rf', root)
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/lista blanca/i)
  })

  it('ignora directorios de run sin output.log', () => {
    writeRun('parcial', 'dnsx', '20260101-100000', 'a.com\n')
    mkdirSync(join(root, 'parcial', 'pentest', 'recon', 'dnsx', '20260102-100000'), { recursive: true })
    writeRun('parcial', 'dnsx', '20260103-100000', 'a.com\nb.com\n')

    const res = diffLatestReconRuns('parcial', 'dnsx', root)
    expect(res.ok).toBe(true)
    // el 0102 (sin output.log) se ignora → compara 0101 vs 0103
    expect(res.previous?.dirName).toBe('20260101-100000')
    expect(res.current?.dirName).toBe('20260103-100000')
    expect(res.diff?.added).toEqual(['b.com'])
  })
})
