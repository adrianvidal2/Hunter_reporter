import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { upsertFindings, type FindingInput } from './findings'
import {
  findingsBySeverityAcrossProjects,
  projectSeverityCount,
  recentFindings,
  repeatedTemplates,
} from './correlation'

let dbPath: string
const created: string[] = []

beforeEach(() => {
  dbPath = mkdtempSync(join(tmpdir(), 'correlation-')) + '/index.db'
  created.push(dbPath)
})

afterAll(() => {
  for (const p of created) rmSync(p, { recursive: true, force: true })
})

const F = (over: Partial<FindingInput> & { host?: string } = {}): FindingInput => ({
  templateId: 'crlf-injection',
  host: 'api.ejemplo.com',
  severity: 'medium',
  name: 'CRLF Injection',
  ...over,
})

/** Fixture multi-proyecto: patrones repetidos + únicos + severidades variadas. */
function seedCrossProject(): void {
  // patrón REPETIDO: tech-detect/xss en 2 proyectos; crlf solo en uno
  upsertFindings('alpha', 'nuclei', 'd1', [
    F({ templateId: 'tech-detect', host: 'a.alpha.com', severity: 'info' }),
    F({ templateId: 'xss-reflected', host: 'a.alpha.com', severity: 'high' }),
    F({ templateId: 'crlf-injection', host: 'a.alpha.com' }),
  ], dbPath)
  upsertFindings('beta', 'nuclei', 'd1', [
    F({ templateId: 'tech-detect', host: 'b.beta.com', severity: 'info' }),
    F({ templateId: 'xss-reflected', host: 'b.beta.com', severity: 'medium' }),
  ], dbPath)
}

describe('findingsBySeverityAcrossProjects (agregados por severidad)', () => {
  it('cuenta por proyecto y severidad, del más grave al más leve', () => {
    seedCrossProject()
    const rows = findingsBySeverityAcrossProjects(dbPath)
    expect(rows).toEqual([
      { project: 'alpha', severity: 'high', count: 1 },
      { project: 'alpha', severity: 'medium', count: 1 },
      { project: 'beta', severity: 'medium', count: 1 },
      { project: 'alpha', severity: 'info', count: 1 },
      { project: 'beta', severity: 'info', count: 1 },
    ])
  })

  it('helper projectSeverityCount consistente con el agregado', () => {
    seedCrossProject()
    expect(projectSeverityCount('alpha', 'high', dbPath)).toBe(1)
    expect(projectSeverityCount('alpha', 'info', dbPath)).toBe(1)
    expect(projectSeverityCount('alpha', 'critical', dbPath)).toBe(0)
  })
})

describe('recentFindings (últimos across proyectos)', () => {
  it('orden por lastSeenAt DESC y límite respetado, mezclando proyectos', async () => {
    upsertFindings('alpha', 'nuclei', 'd1', [F({ templateId: 'viejo' })], dbPath)
    // pequeño margen temporal real para el orden (upsert marca lastSeenAt=now)
    await new Promise((r) => setTimeout(r, 15))
    upsertFindings('beta', 'nuclei', 'd1', [F({ templateId: 'reciente-beta' })], dbPath)
    await new Promise((r) => setTimeout(r, 15))
    upsertFindings('alpha', 'nuclei', 'd2', [F({ templateId: 'reciente-alpha' })], dbPath)

    const rows = recentFindings(2, dbPath)
    expect(rows.map((r) => r.templateId)).toEqual(['reciente-alpha', 'reciente-beta'])
    expect(rows.every((r) => ['alpha', 'beta'].includes(r.project))).toBe(true)

    // sin límite: todos
    expect(recentFindings(100, dbPath)).toHaveLength(3)
  })
})

describe('repeatedTemplates (patrones ENTRE targets)', () => {
  it('solo template_id en ≥2 proyectos; los únicos no; severidad máxima correcta', () => {
    seedCrossProject()
    const repeated = repeatedTemplates(dbPath)
    expect(repeated).toHaveLength(2) // tech-detect y xss-reflected; crlf NO (1 proyecto)

    const byId = new Map(repeated.map((r) => [r.templateId, r]))
    expect(byId.get('tech-detect')).toMatchObject({
      projects: ['alpha', 'beta'],
      occurrences: 2,
      maxSeverity: 'info', // lo máximo que se vio del patrón
    })
    expect(byId.get('xss-reflected')).toMatchObject({
      projects: ['alpha', 'beta'],
      occurrences: 2,
      maxSeverity: 'high', // high (alpha) > medium (beta)
    })
    expect(byId.has('crlf-injection')).toBe(false) // único de alpha: no es patrón cross
  })

  it('mismo proyecto dos veces NO cuenta como patrón cross', () => {
    upsertFindings('solo', 'nuclei', 'd1', [
      F({ templateId: 'dup', host: 'h1.com' }),
      F({ templateId: 'dup', host: 'h2.com' }),
    ], dbPath)
    expect(repeatedTemplates(dbPath)).toEqual([])
  })

  it('BD vacía → resultados vacíos sin romper', () => {
    expect(findingsBySeverityAcrossProjects(dbPath)).toEqual([])
    expect(recentFindings(10, dbPath)).toEqual([])
    expect(repeatedTemplates(dbPath)).toEqual([])
  })

  it('SOLO LECTURA: tras las queries, las filas siguen exactamente igual', () => {
    seedCrossProject()
    const before = recentFindings(100, dbPath)
    findingsBySeverityAcrossProjects(dbPath)
    repeatedTemplates(dbPath)
    recentFindings(100, dbPath)
    expect(recentFindings(100, dbPath)).toEqual(before)
  })
})
