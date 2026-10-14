import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { and, eq, sql } from 'drizzle-orm'
import { parseNucleiFindings, type FindingSeverity } from '../core/recon/findings'
import type { FindingLabel } from '../core/recon/classify'
import { resolveSafe } from '../core/fs/paths'
import { defaultDbPath, openDb } from './db'
import { findings, type FindingRow } from './schema'

/**
 * Índice de findings (Tarea 3): upsert idempotente por
 * (proyecto, template, host) + listado agregado + reconstrucción desde el
 * árbol de runs. La tabla es un ÍNDICE: el disco (output.log) es la verdad
 * y `rebuildFindingsFromDisk` puede borrarla y repoblarla entera.
 */

export interface FindingInput {
  templateId: string
  host: string
  severity: FindingSeverity
  matchedAt?: string
  name?: string
}

export interface UpsertFindingsResult {
  inserted: number
  updated: number
}

/**
 * Alta IDEMPOTENTE: el mismo (project, templateId, host) dos veces deja UNA
 * fila — la primera inserción fija firstSeenAt; las re-visitas refrescan
 * severidad/matchedAt/name/lastSeenAt y el run de origen. Estilo del alta
 * de pendientes (transacción corta por llamada).
 */
export function upsertFindings(
  project: string,
  toolId: string,
  runDir: string,
  items: FindingInput[],
  dbPath: string = defaultDbPath(),
): UpsertFindingsResult {
  const db = openDb(dbPath)
  try {
    return db.transaction((tx) => {
      let inserted = 0
      let updated = 0
      for (const item of items) {
        const existing = tx
          .select({ id: findings.id })
          .from(findings)
          .where(
            and(
              eq(findings.project, project),
              eq(findings.templateId, item.templateId),
              eq(findings.host, item.host),
            ),
          )
          .get()
        if (!existing) {
          tx.insert(findings)
            .values({
              project,
              toolId,
              runDir,
              templateId: item.templateId,
              host: item.host,
              severity: item.severity,
              matchedAt: item.matchedAt ?? null,
              name: item.name ?? null,
            })
            .run()
          inserted++
          continue
        }
        tx.update(findings)
          .set({
            toolId,
            runDir,
            severity: item.severity,
            matchedAt: item.matchedAt ?? null,
            name: item.name ?? null,
            lastSeenAt: new Date(),
          })
          .where(eq(findings.id, existing.id))
          .run()
        updated++
      }
      return { inserted, updated }
    })
  } finally {
    db.$client.close()
  }
}

const SEVERITY_RANK = sql`CASE ${findings.severity}
  WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
  WHEN 'low' THEN 3 ELSE 4 END`

/** Lista agregada del proyecto, del más grave al más leve; filtra por severidad. */
export function listFindings(
  project: string,
  opts: { severity?: FindingSeverity; dbPath?: string } = {},
): FindingRow[] {
  const db = openDb(opts.dbPath ?? defaultDbPath())
  try {
    const where = opts.severity
      ? and(eq(findings.project, project), eq(findings.severity, opts.severity))
      : eq(findings.project, project)
    return db
      .select()
      .from(findings)
      .where(where)
      .orderBy(SEVERITY_RANK, findings.host, findings.templateId)
      .all()
  } finally {
    db.$client.close()
  }
}

/**
 * Parsers de findings por herramienta del árbol de recon. Hoy SOLO nuclei
 * produce hallazgos estructurados; el resto de salidas es inventario de
 * hosts/URLs (para eso está el diffing), no findings.
 */
const FINDINGS_PARSERS: Record<string, (output: string) => ReturnType<typeof parseNucleiFindings>> = {
  nuclei: parseNucleiFindings,
}

export interface RebuildFindingsResult {
  runs: number
  findings: number
}

/**
 * Reconstrucción COMPLETA del índice del proyecto desde el disco (la tabla
 * es reconstruible: borrar y repoblar es su mantenimiento normal). Lee
 * `<project>/pentest/recon/<tool>/<run>/output.log` de cada herramienta con
 * parser, por rutas validadas con resolveSafe. El MISMO hallazgo en varios
 * runs es UNA fila: gana el run más reciente (orden cronológico).
 */
export function rebuildFindingsFromDisk(
  project: string,
  root: string,
  dbPath: string = defaultDbPath(),
): RebuildFindingsResult {
  const reconRel = `${project}/pentest/recon`
  // dedup en memoria por (template, host): los dirs se recorren en orden
  // cronológico, así que la última escritura es el run más reciente
  const byKey = new Map<string, typeof findings.$inferInsert>()
  let runs = 0

  for (const [toolId, parse] of Object.entries(FINDINGS_PARSERS)) {
    const toolDirRel = `${reconRel}/${toolId}`
    let toolDirAbs: string
    try {
      toolDirAbs = resolveSafe(toolDirRel, root)
    } catch {
      continue // proyecto sin runs de esta herramienta
    }
    let runDirs: string[]
    try {
      runDirs = readdirSync(toolDirAbs).sort()
    } catch {
      continue
    }
    for (const runDir of runDirs) {
      let logAbs: string
      try {
        logAbs = resolveSafe(`${toolDirRel}/${runDir}/output.log`, root)
      } catch {
        continue // nombre de dir sospechoso: fuera
      }
      if (!existsSync(logAbs)) continue
      let output: string
      try {
        output = readFileSync(logAbs, 'utf8')
      } catch {
        continue // sin lectura no hay fila: el disco manda y sigue siendo la verdad
      }
      const parsed = parse(output)
      if (parsed.length === 0) continue
      runs++
      for (const f of parsed) {
        byKey.set(`${f.templateId}\u0000${f.host}`, {
          project,
          toolId,
          runDir,
          templateId: f.templateId,
          host: f.host,
          severity: f.severity,
          matchedAt: f.matchedAt || null,
          name: f.name || null,
        })
      }
    }
  }

  const rows = [...byKey.values()]
  const db = openDb(dbPath)
  try {
    return db.transaction((tx) => {
      tx.delete(findings).where(eq(findings.project, project)).run()
      if (rows.length > 0) tx.insert(findings).values(rows).run()
      return { runs, findings: rows.length }
    })
  } finally {
    db.$client.close()
  }
}

// ── Triaje LLM (Tarea 4): SOLO cambia la marca, jamás borra ───────────

export interface TriageMark {
  templateId: string
  host: string
  label: FindingLabel
  confianza: number
  razon: string
}

/**
 * Aplica las marcas de triaje a las filas EXISTENTES del proyecto. Un mark
 * sin fila (hallazgo desaparecido del índice) se ignora sin crear nada:
 * el triaje no puede introducir ni recuperar hallazgos, solo pre-marcar
 * los que ya hay. Devuelve cuántas filas quedaron marcadas.
 */
export function applyTriage(project: string, marks: TriageMark[], dbPath: string = defaultDbPath()): number {
  const db = openDb(dbPath)
  try {
    return db.transaction((tx) => {
      let updated = 0
      const now = new Date()
      for (const mark of marks) {
        const res = tx
          .update(findings)
          .set({
            triageLabel: mark.label,
            triageConfianza: mark.confianza,
            triageRazon: mark.razon,
            triagedAt: now,
          })
          .where(
            and(
              eq(findings.project, project),
              eq(findings.templateId, mark.templateId),
              eq(findings.host, mark.host),
            ),
          )
          .run()
        updated += res.changes
      }
      return updated
    })
  } finally {
    db.$client.close()
  }
}
