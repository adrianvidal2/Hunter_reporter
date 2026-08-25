import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import path from 'node:path'
import { PathEscapeError, resolveSafe } from '@/core/fs/paths'
import { getEnv } from '@/lib/env'

/**
 * GET /api/files/raw?path=<rel> (paso 4.1)
 *
 * Sirve el CONTENIDO de un fichero dentro de REPORTS_ROOT:
 * - `path` se valida con resolveSafe (escapes → 400, no 500 ni lectura)
 * - `nosniff` + Content-Type por extensión: el navegador no adivina tipos
 * - `inline`: se muestra, no se descarga a ciegas
 * - Streaming (Readable.toWeb): un PDF grande no se carga entero en memoria
 */

export const dynamic = 'force-dynamic'

const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status })
}

export async function GET(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get('path')
  if (!raw) return jsonError(400, 'Falta el parámetro ?path=')

  let absPath: string
  try {
    absPath = resolveSafe(raw, getEnv().REPORTS_ROOT)
  } catch (err) {
    if (err instanceof PathEscapeError) return jsonError(400, err.message)
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return jsonError(404, 'Fichero no encontrado')
    }
    console.error('GET /api/files/raw:', err)
    return jsonError(500, 'Error inesperado')
  }

  let stats
  try {
    stats = statSync(absPath)
  } catch {
    return jsonError(404, 'Fichero no encontrado')
  }
  if (!stats.isFile()) return jsonError(404, 'La ruta no es un fichero')

  const contentType = CONTENT_TYPES[path.extname(absPath).toLowerCase()] ?? 'application/octet-stream'
  const stream = Readable.toWeb(createReadStream(absPath)) as ReadableStream<Uint8Array>

  return new Response(stream, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(stats.size),
      // filename* RFC 5987: seguro para nombres unicode sin romper cabeceras
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(absPath))}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  })
}
