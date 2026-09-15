import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DeliverUploadError, looksLikePdf, MAX_PDF_BYTES, saveDeliveredPdf } from './deliver-upload'

const root = mkdtempSync(path.join(tmpdir(), 'deliver-upload-'))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** PDF mínimo con cabecera mágica %PDF-. */
function fakePdf(content: string): Buffer {
  return Buffer.from(`%PDF-1.7\n${content}\n%%EOF\n`)
}

const savedAbs = (project: string, name: string) =>
  path.join(root, project, 'REPORTES_YWH', name)

describe('looksLikePdf', () => {
  it('acepta %PDF- y rechaza cualquier otra cabecera (aunque la extensión sea .pdf)', () => {
    expect(looksLikePdf(fakePdf('x'))).toBe(true)
    expect(looksLikePdf(Buffer.from('<html><body>falso pdf</body></html>'))).toBe(false)
    expect(looksLikePdf(Buffer.from('PK\x03\x04-zip-con-extension-pdf'))).toBe(false)
    expect(looksLikePdf(Buffer.from('%PD'))).toBe(false) // demasiado corto
  })
})

describe('saveDeliveredPdf', () => {
  it('PDF válido → se guarda en REPORTES_YWH/ del proyecto', () => {
    const res = saveDeliveredPdf('proj', 'informe.pdf', fakePdf('contenido'), root)
    expect(res.renamed).toBe(false)
    expect(res.name).toBe('informe.pdf')
    expect(readFileSync(savedAbs('proj', 'informe.pdf'), 'utf8')).toContain('%PDF-')
  })

  it('fichero .pdf que NO es PDF (contenido HTML/zip) → error not_pdf', () => {
    expect(() => saveDeliveredPdf('proj', 'falso.pdf', Buffer.from('<html>hola</html>'), root)).toThrow(
      expect.objectContaining({ kind: 'not_pdf' } as DeliverUploadError),
    )
  })

  it('PDF de 0 bytes → error empty', () => {
    expect(() => saveDeliveredPdf('proj', 'vacio.pdf', Buffer.alloc(0), root)).toThrow(
      expect.objectContaining({ kind: 'empty' } as DeliverUploadError),
    )
  })

  it('colisión → sufijo " (2)" sin sobrescribir; se avisa con renamed', () => {
    saveDeliveredPdf('proj', 'col.pdf', fakePdf('primero'), root)
    const res = saveDeliveredPdf('proj', 'col.pdf', fakePdf('segundo'), root)
    expect(res.renamed).toBe(true)
    expect(res.name).toBe('col (2).pdf')
    // ambos existen e intactos
    expect(readFileSync(savedAbs('proj', 'col.pdf'), 'utf8')).toContain('primero')
    expect(readFileSync(savedAbs('proj', 'col (2).pdf'), 'utf8')).toContain('segundo')
    // y una tercera
    const r3 = saveDeliveredPdf('proj', 'col.pdf', fakePdf('tercero'), root)
    expect(r3.name).toBe('col (3).pdf')
  })

  it('nombre con separadores o ..: sanitizeFilename neutraliza el traversal', () => {
    const res = saveDeliveredPdf('proj', '../../etc/passwd.pdf', fakePdf('x'), root)
    // sanitize: quita separadores y después las secuencias de puntos → 'etcpasswd.pdf'
    expect(res.name).toBe('etcpasswd.pdf')
    // nada escrito fuera de REPORTES_YWH/
    expect(existsSync(path.join(root, 'etc'))).toBe(false)
    expect(existsSync(savedAbs('proj', 'etcpasswd.pdf'))).toBe(true)
    expect(() => saveDeliveredPdf('proj', '..\\..\\win.pdf', fakePdf('x'), root)).not.toThrow()
    expect(existsSync(savedAbs('proj', 'win.pdf'))).toBe(true)
  })

  it('nombre que queda vacío tras sanitizar → error invalid_name', () => {
    expect(() => saveDeliveredPdf('proj', '..', fakePdf('x'), root)).toThrow(
      expect.objectContaining({ kind: 'invalid_name' } as DeliverUploadError),
    )
  })

  it('por encima de 25 MB → error too_big con tamaño en el mensaje', () => {
    const big = Buffer.concat([fakePdf(''), Buffer.alloc(MAX_PDF_BYTES + 1)])
    try {
      saveDeliveredPdf('proj', 'grande.pdf', big, root)
      expect.unreachable()
    } catch (err) {
      expect((err as DeliverUploadError).kind).toBe('too_big')
      expect((err as DeliverUploadError).message).toMatch(/25 MB/)
    }
  })

  it('extensión ausente → se añade .pdf al nombre saneado', () => {
    const res = saveDeliveredPdf('proj', 'sin-extension', fakePdf('x'), root)
    expect(res.name).toBe('sin-extension.pdf')
  })
})
