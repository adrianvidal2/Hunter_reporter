import { desc, sql } from 'drizzle-orm'
import { defaultDbPath, openDb } from './db'
import { findings, type FindingRow } from './schema'

/**
 * Correlación cross-proyecto (Tarea 10a): el "grafo pobre" del estudio
 * docs/kb-retrieval-study.md — SQL sobre `findings` (los datos YA son
 * relacionales en SQLite). CERO ESCRITURA: solo lectura.
 *
 * - Agregados por severidad across programas.
 * - Últimos findings de todos los proyectos.
 * - Patrones reutilizables: mismo template_id en ≥2 proyectos.
 */

const SEVERITY_RANK = sql`CASE ${findings.severity}
  WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
  WHEN 'low' THEN 3 ELSE 4 END`

export interface SeverityCount {
  project: string
  severity: string
  count: number
}

/**
 * Conteos de findings por severidad y proyecto, del más grave al más leve
 * (y proyecto alfabético dentro de cada severidad).
 */
export function findingsBySeverityAcrossProjects(dbPath: string = defaultDbPath()): SeverityCount[] {
  const db = openDb(dbPath)
  try {
    return db
      .select({
        project: findings.project,
        severity: findings.severity,
        count: sql<number>`COUNT(*)`.as('count'),
      })
      .from(findings)
      .groupBy(findings.project, findings.severity)
      .orderBy(SEVERITY_RANK, findings.project)
      .all()
      .map((r) => ({ project: r.project, severity: r.severity, count: Number(r.count) }))
  } finally {
    db.$client.close()
  }
}

/** Últimos findings de TODOS los proyectos (por lastSeenAt/lastSeen, luego id). */
export function recentFindings(limit: number = 20, dbPath: string = defaultDbPath()): FindingRow[] {
  const db = openDb(dbPath)
  try {
    return db
      .select()
      .from(findings)
      .orderBy(desc(findings.lastSeenAt), desc(findings.id))
      .limit(Math.max(1, limit))
      .all()
  } finally {
    db.$client.close()
  }
}

export interface RepeatedTemplate {
  templateId: string
  /** Proyectos donde aparece el mismo patrón (≥2). */
  projects: string[]
  /** Total de hits del patrón across proyectos. */
  occurrences: number
  /** La severidad MÁXIMA con la que se ha visto (critical > … > info). */
  maxSeverity: string
}

/**
 * Patrones repetidos ENTRE targets: mismo `template_id` en ≥2 proyectos.
 * Lo que solo sale en un proyecto NO es patrón cross (no se lista).
 */
export function repeatedTemplates(dbPath: string = defaultDbPath()): RepeatedTemplate[] {
  const db = openDb(dbPath)
  try {
    const rows = db
      .select({
        templateId: findings.templateId,
        projects: sql<string>`GROUP_CONCAT(DISTINCT ${findings.project})`.as('projects'),
        occurrences: sql<number>`COUNT(*)`.as('occurrences'),
        maxSeverity: sql<string>`MIN(CASE ${findings.severity}
          WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
          WHEN 'low' THEN 3 ELSE 4 END)`.as('maxSeverity'),
      })
      .from(findings)
      .groupBy(findings.templateId)
      .having(sql`COUNT(DISTINCT ${findings.project}) >= 2`)
      .orderBy(sql`COUNT(DISTINCT ${findings.project}) DESC`, findings.templateId)
      .all()

    return rows
      .map((r) => ({
        templateId: r.templateId,
        projects: (r.projects ?? '').split(',').filter((p) => p !== ''),
        occurrences: Number(r.occurrences),
        // MIN del rank: 0=critical … 4=info → traducir de vuelta
        maxSeverity: (['critical', 'high', 'medium', 'low', 'info'] as const)[
          Math.min(4, Math.max(0, Number(r.maxSeverity)))
        ],
      }))
      .filter((r) => r.projects.length >= 2)
  } finally {
    db.$client.close()
  }
}

/** Resumen de una sola severidad en un proyecto (helper para la vista). */
export function projectSeverityCount(
  project: string,
  severity: string,
  dbPath: string = defaultDbPath(),
): number {
  const db = openDb(dbPath)
  try {
    const row = db
      .select({ count: sql<number>`COUNT(*)`.as('count') })
      .from(findings)
      .where(sql`${findings.project} = ${project} AND ${findings.severity} = ${severity}`)
      .get()
    return Number(row?.count ?? 0)
  } finally {
    db.$client.close()
  }
}
