import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ REPORTS_ROOT: env.root }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createFindingDraftAction, diffReconAction } from './recon-actions'

const root = mkdtempSync(join(tmpdir(), 'recon-actions-diff-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** Crea un run de una herramienta con su output.log (sin run.json: al diff no le hace falta). */
function writeRun(project: string, toolId: string, dirName: string, output: string): void {
  const dir = join(root, project, 'pentest', 'recon', toolId, dirName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'output.log'), output)
}

describe('diffReconAction (diff de los dos runs más recientes vía server action)', () => {
  beforeEach(() => { env.root = root })

  it('dos runs de subfinder → ok:true, added correcto y refs de los dos dirs más recientes', async () => {
    writeRun('demo', 'subfinder', '20260101-100000', 'a.ejemplo.com\nb.ejemplo.com\n')
    writeRun('demo', 'subfinder', '20260102-100000', 'b.ejemplo.com\nc.ejemplo.com\n')
    // un tercer run MÁS VIEJO no debe participar: comparan los dos últimos
    writeRun('demo', 'subfinder', '20251231-100000', 'z.ejemplo.com\n')

    const res = await diffReconAction('demo', 'subfinder')
    expect(res.ok).toBe(true)
    expect(res.previous?.dirName).toBe('20260101-100000')
    expect(res.current?.dirName).toBe('20260102-100000')
    expect(res.previous?.relPath).toBe('demo/pentest/recon/subfinder/20260101-100000')
    expect(res.current?.relPath).toBe('demo/pentest/recon/subfinder/20260102-100000')
    expect(res.diff).toEqual({
      added: ['c.ejemplo.com'],
      removed: ['a.ejemplo.com'],
      unchanged: ['b.ejemplo.com'],
    })
  })

  it('herramienta de URLs (gau): diff por URL, no por host', async () => {
    writeRun('urls', 'gau', '20260101-100000', 'https://ejemplo.com/vieja\nhttps://ejemplo.com/comun\n')
    writeRun('urls', 'gau', '20260102-100000', 'https://ejemplo.com/comun\nhttps://ejemplo.com/nueva\n')

    const res = await diffReconAction('urls', 'gau')
    expect(res.ok).toBe(true)
    expect(res.diff?.added).toEqual(['https://ejemplo.com/nueva'])
    expect(res.diff?.removed).toEqual(['https://ejemplo.com/vieja'])
  })

  it('un solo run → ok:false pidiendo dos runs', async () => {
    writeRun('solo', 'httpx', '20260101-100000', 'https://x.ejemplo.com\n')
    const res = await diffReconAction('solo', 'httpx')
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/dos runs/i)
  })

  it('herramienta no diffeable (nmap) → ok:false: no es comparable', async () => {
    writeRun('demo', 'nmap', '20260101-100000', 'PORT STATE SERVICE\n80/tcp open http\n')
    const res = await diffReconAction('demo', 'nmap')
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/comparable/i)
  })

  it('herramienta fuera de la lista blanca → ok:false por lista blanca (antes de tocar disco)', async () => {
    const res = await diffReconAction('demo', 'rm-rf')
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/lista blanca/i)
  })

  it('proyecto sin runs de esa herramienta → ok:false "sin runs"', async () => {
    const res = await diffReconAction('vacio', 'subfinder')
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/sin runs/i)
  })
})

describe('createFindingDraftAction (borrador de reporte desde un finding)', () => {
  beforeEach(() => {
    env.root = root
    mkdirSync(join(root, 'demo', 'reportes'), { recursive: true })
  })

  it('rellena DEFAULT_TEMPLATE con los datos del finding; placeholders sin dato quedan visibles', async () => {
    const res = await createFindingDraftAction('demo', {
      templateId: 'crlf-injection',
      host: 'api.ejemplo.com',
      severity: 'medium',
      name: 'CRLF Injection',
    })
    expect(res.ok).toBe(true)
    expect(res.path).toMatch(/^demo\/reportes\/finding-crlf-injection-api\.ejemplo\.com\.md$/)

    const md = readFileSync(join(root, res.path!), 'utf8')
    expect(md).toContain('# CRLF Injection')
    expect(md).toContain('**Target:** api.ejemplo.com  ')
    expect(md).toContain('**Severity:** medium')
    expect(md).toMatch(/^\*\*Date:\*\* \d{4}-\d{2}-\d{2}$/m)
    expect(md).toContain('## Finding 1 — CRLF Injection')
    // sin dato → placeholder VISIBLE (nada se pierde en silencio)
    expect(md).toContain('{{programa}}')
    expect(md).toContain('{{cvss}}')
    expect(md).toContain('{{request}}')
    expect(md).toContain('{{referencias}}')
  })

  it('no pisa: el segundo borrador del MISMO finding lleva sufijo -2', async () => {
    const f = { templateId: 'xss-reflected', host: 'app.ejemplo.com', severity: 'high' }
    const r1 = await createFindingDraftAction('demo', f)
    const r2 = await createFindingDraftAction('demo', f)
    expect(r1.ok && r2.ok).toBe(true)
    expect(r1.path).not.toBe(r2.path)
    expect(r2.path).toMatch(/-2\.md$/)
    // el primero sigue intacto con su contenido
    expect(readFileSync(join(root, r1.path!), 'utf8')).toContain('# xss-reflected')
  })

  it('finding sin template ni host → rechazado; proyecto inexistente → error', async () => {
    expect(await createFindingDraftAction('demo', { templateId: '', host: 'x.com', severity: 'low' })).toMatchObject({ ok: false })
    expect(await createFindingDraftAction('demo', { templateId: 'x', host: '', severity: 'low' })).toMatchObject({ ok: false })
    expect(
      await createFindingDraftAction('no-existe', { templateId: 'x', host: 'y.com', severity: 'low' }),
    ).toMatchObject({ ok: false, error: /No existe el proyecto/ })
  })
})
