import { listProjects } from '@/core/fs/tree'
import { DeliverUploadError, saveDeliveredPdf } from '@/core/fs/deliver-upload'
import { getEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * POST /api/projects/[project]/deliver — subida de PDFs entregados.
 *
 * Body: multipart/form-data con uno o varios campos "files".
 * Por fichero: valida magia %PDF- (no extensión/content-type), 25 MB máx,
 * sanitizeFilename + sufijo " (n)" en colisión, writeAtomic en
 * REPORTES_YWH/. Un fichero que falla NO corta los demás: la respuesta es
 * 200 con un informe por fichero ({ok:false} incluidos).
 */

interface FileReport {
  /** Nombre tal y como lo mandó el navegador. */
  original: string
  ok: boolean
  /** Nombre final guardado (con sufijo si hubo colisión). */
  name?: string
  /** true si se renombró por colisión. */
  renamed?: boolean
  error?: string
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ project: string }> },
) {
  const { project } = await params
  const root = getEnv().REPORTS_ROOT

  if (!listProjects(root).includes(project)) {
    return Response.json({ error: `No existe el proyecto: ${project}` }, { status: 404 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'Se esperaba multipart/form-data' }, { status: 400 })
  }

  const files = [...form.getAll('files')].filter((f): f is File => f instanceof File)
  if (files.length === 0) {
    return Response.json({ error: 'Sin ficheros (campo "files")' }, { status: 400 })
  }

  const results: FileReport[] = []
  for (const file of files) {
    try {
      const bytes = Buffer.from(await file.arrayBuffer())
      const res = saveDeliveredPdf(project, file.name, bytes, root)
      results.push({ original: file.name, ok: true, name: res.name, renamed: res.renamed })
    } catch (err) {
      if (err instanceof DeliverUploadError) {
        results.push({ original: file.name, ok: false, error: err.message })
      } else {
        results.push({
          original: file.name,
          ok: false,
          error: err instanceof Error ? err.message : 'Error inesperado',
        })
      }
    }
  }

  return Response.json({ results }, { status: 200 })
}
