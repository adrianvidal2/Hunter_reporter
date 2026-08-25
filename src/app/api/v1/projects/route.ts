import { listProjects } from '@/core/fs/tree'
import { checkApiToken } from '@/lib/auth'
import { getEnv } from '@/lib/env'

/**
 * GET /api/v1/projects (5.6): nombres de proyectos de primer nivel.
 * Mismo token Bearer que la ingesta: nada de enumeración sin autenticar.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const unauthorized = checkApiToken(request)
  if (unauthorized) return unauthorized

  return Response.json({ projects: listProjects(getEnv().REPORTS_ROOT) })
}
