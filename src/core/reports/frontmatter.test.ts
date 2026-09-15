import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getMeta, splitFrontMatter, updateMeta } from './frontmatter'

const here = path.dirname(fileURLToPath(import.meta.url))
const realSample = (name: string) =>
  readFileSync(path.join(here, '../../test/fixtures/real-samples', name), 'utf8')

/** Front-matter manuscrito con estilos mixtos, campos raros y anidados. */
const HANDWRITTEN = [
  '---',
  'title: "Informe IDOR en /api/v1/users"',
  "Severity: 'alta'",
  'cvss: 8.6',
  'state: draft   # comentario manuscrito',
  'reporter: alguien@example.com  # campo que la app NO conoce',
  'tags: [web, api, idor]',
  'references:',
  '  - https://example.com/issue/1',
  '  - https://example.com/issue/2',
  '---',
  '',
  '# Título del reporte',
  '',
  'Cuerpo **intacto**.',
].join('\n')

describe('splitFrontMatter · tolerancia con contenido real', () => {
  it('los reportes reales SIN front-matter no se confunden (--- interno incluido)', () => {
    for (const name of ['aws-excerpt.md', 'criticos-excerpt.md', 'authforge-excerpt.md']) {
      const raw = realSample(name)
      const split = splitFrontMatter(raw)
      expect(split.hasFm, name).toBe(false)
      // sin cambios → documento idéntico
      expect(updateMeta(raw, {})).toBe(raw)
      expect(getMeta(raw)).toEqual({})
    }
  })

  it('detecta el bloque solo cuando abre y cierra', () => {
    expect(splitFrontMatter(HANDWRITTEN).hasFm).toBe(true)
    expect(splitFrontMatter('---\nabre sin cerrar\n')).toEqual(
      expect.objectContaining({ hasFm: false }),
    )
    expect(splitFrontMatter('--- \ntitle: x\n---\n').hasFm).toBe(false) // "--- " no es delimitador
  })
})

describe('4.10 · round-trip sin pérdida (requisito clave)', () => {
  it('updateMeta sin cambios → MISMA referencia (byte a byte idéntico)', () => {
    for (const raw of [HANDWRITTEN, realSample('aws-excerpt.md'), '---\n---\n', '# sin fm\n']) {
      expect(updateMeta(raw, {})).toBe(raw)
      // re-aplicar los valores actuales tampoco toca nada
      expect(updateMeta(raw, getMeta(raw) as Record<string, string>)).toBe(raw)
    }
  })

  it('cambiar SOLO severity deja el resto del fichero byte a byte intacto', () => {
    const next = updateMeta(HANDWRITTEN, { severity: 'critical' })
    const diff = changedLines(HANDWRITTEN, next)
    expect(diff).toEqual([
      ["Severity: 'alta'", "Severity: 'critical'"], // misma clave (mayúscula) y su estilo de comillas
    ])
    // body idéntico (el original no lleva EOL final y se conserva así):
    expect(next.endsWith('# Título del reporte\n\nCuerpo **intacto**.')).toBe(true)
  })

  it('conserva estilo de comillas y comentario de línea al editar otras claves', () => {
    const next = updateMeta(HANDWRITTEN, { cvss: '9.1' })
    const lines = next.split('\n')
    expect(lines).toContain('title: "Informe IDOR en /api/v1/users"') // dobles intactas
    expect(lines.some((l) => l.startsWith('state: draft') && l.includes('# comentario manuscrito'))).toBe(true)
    expect(lines).toContain('cvss: 9.1')
    expect(lines).toContain('references:') // anidados intactos
    expect(lines).toContain('  - https://example.com/issue/1')
    expect(lines.filter((l) => l.startsWith('  - '))).toHaveLength(2)
  })

  it('getMeta lee case-insensitive, unquotea y limpia comentarios inline', () => {
    expect(getMeta(HANDWRITTEN)).toEqual({
      title: 'Informe IDOR en /api/v1/users',
      severity: 'alta',
      cvss: '8.6',
      state: 'draft',
    })
  })

  it('valor vacío elimina la clave; añadirla de nuevo va al final del bloque', () => {
    const removed = updateMeta(HANDWRITTEN, { state: '' })
    expect(removed).not.toContain('state:')
    const readded = updateMeta(removed, { state: 'submitted' })
    const fmLines = splitFrontMatter(readded).lines
    expect(fmLines.at(-1)).toBe('state: submitted')
  })

  it('sin front-matter: añadir metadatos inserta el bloque sin tocar el body', () => {
    const raw = realSample('aws-excerpt.md')
    const next = updateMeta(raw, { severity: 'critical', cvss: '10.0' })
    expect(next.startsWith('---\nseverity: critical\ncvss: 10.0\n---\n\n')).toBe(true)
    expect(next.endsWith(raw)).toBe(true)
  })

  it('idempotente: aplicar el mismo cambio dos veces da el mismo resultado', () => {
    const once = updateMeta(HANDWRITTEN, { title: 'Nuevo título' })
    const twice = updateMeta(once, { title: 'Nuevo título' })
    expect(twice).toBe(once)
  })

  it('valores que requieren comillas se escriben seguros', () => {
    const next = updateMeta(HANDWRITTEN, { title: 'Título: con "comillas" y #hash' })
    expect(next).toContain('title: "Título: con \\"comillas\\" y #hash"')
  })

  it('cvss_vector (calculadora): round-trip getMeta/updateMeta con el vector plano', () => {
    const vector = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'
    const next = updateMeta(HANDWRITTEN, { cvss: '9.8', cvss_vector: vector })
    const meta = getMeta(next)
    expect(meta.cvss).toBe('9.8')
    expect(meta.cvss_vector).toBe(vector)
    // idempotente: reescribir lo mismo no cambia nada
    expect(updateMeta(next, { cvss_vector: vector })).toBe(next)
  })
})

function changedLines(before: string, after: string): [string, string][] {
  const a = before.split('\n')
  const b = after.split('\n')
  const out: [string, string][] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) out.push([a[i] ?? '', b[i] ?? ''])
  }
  return out
}
