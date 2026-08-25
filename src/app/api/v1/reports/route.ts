import { existsSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { writeAtomic } from '@/core/fs/atomic'
import { PathEscapeError, resolveSafeAllowMissing } from '@/core/fs/paths'
import { InvalidFilenameError, sanitizeFilename } from '@/core/fs/sanitize'
import { listProject, listProjects } from '@/core/fs/tree'
import { checkApiToken } from '@/lib/auth'
import { getEnv } from '@/lib/env'
import { readJsonBody } from '@/lib/http'

/**
 * POST /api/v1/reports — API de ingesta (pasos 5.1/5.2).
 *
 * Body: { content: string, filename?: string, project?: string }
 *
 * - Sin `project` → cae en `_inbox/` (markdown sin proyecto asignado).
 * - Con `project` → debe existir (si no, 404) y cae en `<project>/reportes/`.
 * - `filename` pasa por sanitizeFilename; los nombres con separadores o `..`
 *   se RECHAZAN (400): en una API automatizada eso es bug del emisor, no se
 *   adivina su intención. Los nombres limpios se normalizan (NFC, etc.) y
 *   siempre acaban en `.md`.
 * - Colisión de nombre → 409 (la política de sufijos llega en 5.4).
 *
 * - Colisión de nombre: sufijo ` (2)`, ` (3)`… por defecto; `overwrite: false`
 *   → 409 sin tocar el existente (5.4).
 *
 * Autenticación (5.3): token Bearer estático de .env.local, comparado en
 * tiempo constante (ver src/lib/auth.ts). Sin token → 401.
 */

export const dynamic = 'force-dynamic'

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status })
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** Nombre autogenerado: report-AAAAMMDD-HHMMSS-<hex>.md */
function defaultName(): string {
  const d = new Date()
  const ts =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `report-${ts}-${randomBytes(3).toString('hex')}.md`
}

interface IngestBody {
  content?: unknown
  filename?: unknown
  project?: unknown
  overwrite?: unknown
}

export async function POST(request: Request): Promise<Response> {
  const unauthorized = checkApiToken(request)
  if (unauthorized) return unauthorized

  const bodyResult = await readJsonBody(request)
  if (!bodyResult.ok) return jsonError(bodyResult.status, bodyResult.error)
  const body = bodyResult.data as IngestBody

  if (typeof body.content !== 'string' || body.content === '') {
    return jsonError(400, '"content" es obligatorio y debe ser un string no vacío')
  }
  if (body.overwrite !== undefined && typeof body.overwrite !== 'boolean') {
    return jsonError(400, '"overwrite" debe ser boolean')
  }

  const root = getEnv().REPORTS_ROOT

  // Destino: _inbox o el proyecto (que debe existir). Sin efectos secundarios:
  // los directorios se crean solo cuando el request ya es válido.
  let dir: string
  if (body.project === undefined) {
    dir = '_inbox'
  } else {
    if (typeof body.project !== 'string' || !listProjects(root).includes(body.project)) {
      return jsonError(404, `El proyecto ${JSON.stringify(String(body.project))} no existe`)
    }
    dir = `${body.project}/reportes`
  }

  // Nombre: autogenerado o saneado
  let name: string
  if (body.filename === undefined) {
    name = defaultName()
  } else {
    if (typeof body.filename !== 'string') {
      return jsonError(400, '"filename" debe ser un string')
    }
    if (/[/\\]/.test(body.filename) || body.filename.includes('..')) {
      return jsonError(
        400,
        '"filename" no puede contener separadores de ruta ni ".." (usa un nombre simple)',
      )
    }
    try {
      name = sanitizeFilename(body.filename)
    } catch (err) {
      if (err instanceof InvalidFilenameError) return jsonError(400, err.message)
      throw err
    }
  }
  if (!name.toLowerCase().endsWith('.md')) name += '.md'

  const relPath = `${dir}/${name}`

  // Validación de contención (defensa en profundidad: name ya está saneado)
  let absPath: string
  try {
    absPath = resolveSafeAllowMissing(relPath, root)
  } catch (err) {
    if (err instanceof PathEscapeError) return jsonError(400, err.message)
    throw err
  }
  // 5.4: colisión → sufijo " (n)" por defecto; 409 si overwrite:false
  let finalRel = relPath
  if (existsSync(absPath)) {
    if (body.overwrite === false) {
      return jsonError(409, `Ya existe un fichero en "${relPath}"`)
    }
    const stem = name.replace(/\.md$/i, '')
    for (let i = 2; ; i++) {
      finalRel = `${dir}/${stem} (${i}).md`
      absPath = resolveSafeAllowMissing(finalRel, root)
      if (!existsSync(absPath)) break
    }
  }

  // Request válido: ahora sí, garantizar el directorio destino (cubre _inbox
  // y reportes/ de un proyecto legítimo por igual) y escribir.
  mkdirSync(path.dirname(absPath), { recursive: true })
  writeAtomic(finalRel, body.content, { root })
  return Response.json({ path: finalRel }, { status: 201 })
}

/**
 * GET /api/v1/reports?project=<nombre> (5.6): listado de un proyecto con
 * la misma forma que la UI (delivered/drafts con relPath, size, mtimeMs).
 */
export async function GET(request: Request): Promise<Response> {
  const unauthorized = checkApiToken(request)
  if (unauthorized) return unauthorized

  const project = new URL(request.url).searchParams.get('project')
  if (!project) return jsonError(400, 'Falta el parámetro ?project=')

  const root = getEnv().REPORTS_ROOT
  if (!listProjects(root).includes(project)) {
    return jsonError(404, `El proyecto ${JSON.stringify(project)} no existe`)
  }
  return Response.json(listProject(project, root))
}
