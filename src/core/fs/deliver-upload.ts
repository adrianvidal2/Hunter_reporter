import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { writeAtomic } from '../fs/atomic'
import { resolveSafeAllowMissing } from '../fs/paths'
import { sanitizeFilename, InvalidFilenameError } from '../fs/sanitize'
import { getEnv } from '../../lib/env'

/**
 * Subida de PDFs entregados desde la app (REPORTES_YWH/ de un proyecto).
 *
 * Reglas:
 * - Solo PDFs: se valida la MAGIA del fichero (primeros bytes `%PDF-`),
 *   NO la extensión ni el content-type del navegador.
 * - El nombre pasa por sanitizeFilename y la ruta destino se resuelve con
 *   resolveSafeAllowMissing: nada de construir rutas a mano.
 * - Colisión → sufijo ` (2)`, ` (3)`… como el 5.4: JAMÁS se sobrescribe.
 * - Límite de 25 MB por fichero.
 * - Escritura atómica (writeAtomic).
 */

/** Límite de tamaño por fichero (25 MB). */
export const MAX_PDF_BYTES = 25 * 1024 * 1024

export type UploadErrorKind = 'not_pdf' | 'empty' | 'too_big' | 'invalid_name' | 'path_escape'

export class DeliverUploadError extends Error {
  constructor(
    public kind: UploadErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'DeliverUploadError'
  }
}

/** Los primeros bytes de un PDF real son `%PDF-`. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
  if (bytes.length < magic.length) return false
  return magic.every((b, i) => bytes[i] === b)
}

/**
 * Guarda un PDF entregado en `REPORTES_YWH/` del proyecto.
 * @returns nombre final (puede llevar sufijo ` (n)` si hubo colisión) y
 *          whetherRenamed para avisar en la UI.
 */
export function saveDeliveredPdf(
  project: string,
  originalName: string,
  bytes: Buffer,
  root: string = getEnv().REPORTS_ROOT,
): { name: string; renamed: boolean; relPath: string } {
  if (bytes.length === 0) {
    throw new DeliverUploadError('empty', 'El fichero está vacío (0 bytes): no es un PDF válido')
  }
  if (bytes.length > MAX_PDF_BYTES) {
    throw new DeliverUploadError(
      'too_big',
      `Supera el límite de 25 MB (${(bytes.length / (1024 * 1024)).toFixed(1)} MB)`,
    )
  }
  if (!looksLikePdf(bytes.subarray(0, 8))) {
    throw new DeliverUploadError('not_pdf', 'El contenido no empieza por %PDF-: no es un PDF válido')
  }

  let name: string
  try {
    name = sanitizeFilename(originalName)
  } catch (err) {
    if (err instanceof InvalidFilenameError) {
      throw new DeliverUploadError('invalid_name', err.message)
    }
    throw err
  }
  if (!/\.pdf$/i.test(name)) name = `${name}.pdf`

  // Ruta destino SIEMPRE resuelta (nunca construida a mano)
  const resolve = (rel: string) => resolveSafeAllowMissing(rel, root)
  const relBase = `${project}/REPORTES_YWH/${name}`
  let relFinal = relBase
  let absFinal = resolve(relFinal)
  let renamed = false

  if (existsSync(absFinal)) {
    const stem = name.replace(/\.pdf$/i, '')
    for (let i = 2; ; i++) {
      relFinal = `${project}/REPORTES_YWH/${stem} (${i}).pdf`
      absFinal = resolve(relFinal)
      if (!existsSync(absFinal)) break
    }
    renamed = true
  }

  mkdirSync(path.dirname(absFinal), { recursive: true })
  writeAtomic(relFinal, bytes, { root })
  return { name: path.basename(relFinal), renamed, relPath: relFinal }
}
