import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { openDb } from './db'
import { findings } from './schema'
import { listFindings, rebuildFindingsFromDisk, upsertFindings, type FindingInput } from './findings'

let root: string
let dbPath: string
const created: string[] = []

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'findings-db-'))
  dbPath = join(root, 'index.db')
  created.push(root)
})

afterAll(() => {
  for (const p of created) rmSync(p, { recursive: true, force: true })
})

const F = (over: Partial<FindingInput> = {}): FindingInput => ({
  templateId: 'crlf-injection',
  host: 'api.ejemplo.com',
  severity: 'medium',
  matchedAt: 'https://api.ejemplo.com/search?q=x',
  name: 'CRLF Injection',
  ...over,
})

describe('upsertFindings (alta idempotente por proyecto+template+host)', () => {
  it('mismo finding dos veces → 1 fila: se refresca, firstSeen se conserva', () => {
    expect(upsertFindings('demo', 'nuclei', '20260101-100000', [F()], dbPath)).toEqual({ inserted: 1, updated: 0 })
    const again = upsertFindings('demo', 'nuclei', '20260102-100000', [F({ severity: 'high' })], dbPath)
    expect(again).toEqual({ inserted: 0, updated: 1 })

    const rows = listFindings('demo', { dbPath })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ severity: 'high', runDir: '20260102-100000' })
    expect(rows[0]!.firstSeenAt.getTime()).toBeLessThanOrEqual(rows[0]!.lastSeenAt.getTime())
  })

  it('hallazgos distintos → filas distintas; por proyecto NO se mezclan', () => {
    upsertFindings('demo', 'nuclei', 'd1', [
      F(),
      F({ templateId: 'xss', host: 'app.ejemplo.com', severity: 'critical' }),
    ], dbPath)
    upsertFindings('otro', 'nuclei', 'd1', [F({ host: 'api.otro.com' })], dbPath)
    expect(listFindings('demo', { dbPath })).toHaveLength(2)
    expect(listFindings('otro', { dbPath })).toHaveLength(1)
  })
})

describe('listFindings (agregado por severidad)', () => {
  it('orden del más grave al más leve; filtro por severidad', () => {
    upsertFindings('demo', 'nuclei', 'd1', [
      F({ templateId: 'a', host: 'a.ejemplo.com', severity: 'info' }),
      F({ templateId: 'b', host: 'b.ejemplo.com', severity: 'low' }),
      F({ templateId: 'c', host: 'c.ejemplo.com', severity: 'critical' }),
      F({ templateId: 'd', host: 'd.ejemplo.com', severity: 'high' }),
    ], dbPath)

    expect(listFindings('demo', { dbPath }).map((r) => r.severity)).toEqual([
      'critical', 'high', 'low', 'info',
    ])
    expect(listFindings('demo', { severity: 'high', dbPath }).map((r) => r.templateId)).toEqual(['d'])
  })
})

describe('rebuildFindingsFromDisk (la tabla es un índice RECONSTRUIBLE)', () => {
  /** Crea un run de nuclei con su output.log JSONL. */
  function writeNucleiRun(project: string, dir: string, output: string): void {
    const d = join(root, project, 'pentest', 'recon', 'nuclei', dir)
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'output.log'), output)
  }

  const line = (templateId: string, host: string, severity = 'high'): string =>
    JSON.stringify({ 'template-id': templateId, host, info: { name: templateId, severity } })

  it('borra y repuebla desde los output.log; el mismo hallazgo en varios runs es UNA fila (gana el reciente)', () => {
    writeNucleiRun('demo', '20260101-100000', `${line('crlf', 'api.ejemplo.com', 'medium')}\n${line('tech', 'api.ejemplo.com', 'info')}\n`)
    writeNucleiRun('demo', '20260102-100000', `${line('crlf', 'api.ejemplo.com', 'high')}\n${line('xss', 'app.ejemplo.com')}\n`)
    // runs de herramientas SIN parser: se ignoran (no son findings)
    writeNucleiRun('demo', 'basura', 'esto no es json\n')

    const res = rebuildFindingsFromDisk('demo', root, dbPath)
    expect(res.runs).toBe(2) // el dir "basura" no cuenta: no produce hallazgos
    expect(res.findings).toBe(3) // crlf (dedup entre runs) + tech + xss

    const rows = listFindings('demo', { dbPath })
    const crlf = rows.find((r) => r.templateId === 'crlf')!
    expect(crlf.severity).toBe('high') // el run MÁS RECIENTE manda
    expect(crlf.runDir).toBe('20260102-100000')
  })

  it('reconstruible de verdad: borrado a mano del índice → repoblado idéntico desde disco', () => {
    writeNucleiRun('demo', '20260101-100000', `${line('crlf', 'api.ejemplo.com')}\n`)
    expect(rebuildFindingsFromDisk('demo', root, dbPath).findings).toBe(1)

    // "pérdida" del índice: se borra TODO el contenido de la tabla
    const db = openDb(dbPath)
    db.delete(findings).where(eq(findings.project, 'demo')).run()
    db.$client.close()
    expect(listFindings('demo', { dbPath })).toHaveLength(0)

    // repoblar desde disco (única fuente de verdad) restaura el índice
    expect(rebuildFindingsFromDisk('demo', root, dbPath).findings).toBe(1)
    const rows = listFindings('demo', { dbPath })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ templateId: 'crlf', host: 'api.ejemplo.com', severity: 'high' })
  })

  it('proyecto sin runs de nuclei → índice vacío, sin error', () => {
    expect(rebuildFindingsFromDisk('vacio', root, dbPath)).toEqual({ runs: 0, findings: 0 })
    expect(listFindings('vacio', { dbPath })).toEqual([])
  })

  it('output.log malformado se ignora sin romper el rebuild', () => {
    writeNucleiRun('demo', '20260101-100000', 'esto\nno es\njson\n')
    expect(rebuildFindingsFromDisk('demo', root, dbPath)).toEqual({ runs: 0, findings: 0 })
    expect(readFileSync(join(root, 'demo', 'pentest', 'recon', 'nuclei', '20260101-100000', 'output.log'), 'utf8')).toContain('json')
  })
})
