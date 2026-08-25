import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Fixture de tests: árbol de reportes de mentira, siempre en `tmpdir`.
 * JAMÁS toca la carpeta `reportes` real (regla 5 del plan).
 *
 * Estructura creada:
 *
 *   <root>/                              ← REPORTS_ROOT desechable
 *   └── demo_project/
 *       ├── REPORTES_YWH/
 *       │   └── informe-xss-reflejado.pdf
 *       └── reportes/
 *           ├── borrador-sqli.md         (sin front-matter)
 *           └── informe-idor.md          (con front-matter)
 */

export const PROJECT_NAME = 'demo_project'

export interface FixtureOptions {
  /** Nombres de proyectos adicionales: directorios vacíos de primer nivel. */
  extraProjects?: string[]
}

export interface Fixture {
  /** Directorio raíz desechable (REPORTS_ROOT del test). */
  root: string
  /** `<root>/demo_project` */
  project: string
  /** `<project>/REPORTES_YWH` */
  deliveredDir: string
  /** `<project>/reportes` */
  draftsDir: string
  pdf: string
  mdPlain: string
  mdFrontMatter: string
  /** Borra el árbol completo. Idempotente: se puede llamar dos veces. */
  cleanup: () => void
}

/** PDF mínimo pero estructuralmente válido (xref correcto), una página en blanco con texto. */
function buildMinimalPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 50 800 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]

  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })

  const xrefPos = Buffer.byteLength(body, 'latin1')
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`

  return Buffer.from(body + xref + trailer, 'latin1')
}

const MD_PLAIN = `# Borrador: SQLi en el buscador

Pendiente de revisar. Todavía sin front-matter.
`

const MD_FRONT_MATTER = `---
title: IDOR en /api/v1/users/{id}
severity: critical
cvss: 8.6
state: draft
---

# IDOR en /api/v1/users/{id}

## Resumen

El endpoint revela datos de otros usuarios cambiando el id.
`

export function createFixture(options: FixtureOptions = {}): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'reporter-fx-'))
  const project = path.join(root, PROJECT_NAME)
  const deliveredDir = path.join(project, 'REPORTES_YWH')
  const draftsDir = path.join(project, 'reportes')

  mkdirSync(deliveredDir, { recursive: true })
  mkdirSync(draftsDir, { recursive: true })
  for (const name of options.extraProjects ?? []) {
    mkdirSync(path.join(root, name), { recursive: true })
  }

  const pdf = path.join(deliveredDir, 'informe-xss-reflejado.pdf')
  const mdPlain = path.join(draftsDir, 'borrador-sqli.md')
  const mdFrontMatter = path.join(draftsDir, 'informe-idor.md')

  writeFileSync(pdf, buildMinimalPdf('reporter fixture - informe de prueba'))
  writeFileSync(mdPlain, MD_PLAIN)
  writeFileSync(mdFrontMatter, MD_FRONT_MATTER)

  const cleanup = () => rmSync(root, { recursive: true, force: true })

  return { root, project, deliveredDir, draftsDir, pdf, mdPlain, mdFrontMatter, cleanup }
}
