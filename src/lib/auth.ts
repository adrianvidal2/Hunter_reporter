import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Autenticación de la API de ingesta (paso 5.3).
 *
 * Token estático `Bearer` desde `API_TOKEN` (.env.local). NO es
 * autenticación de usuarios (fuera de alcance): es la clave con la que
 * tus scripts escriben.
 *
 * La comparación es en tiempo constante: ambos lados se pasan por sha-256
 * (misma longitud siempre) y se comparan con timingSafeEqual, sin cortar
 * al primer byte distinto ni filtrar la longitud del token esperado.
 *
 * Si `API_TOKEN` no está configurado, la API queda CERRADA (500 con mensaje
 * claro): sin token configurado no se acepta a nadie.
 */

/** @returns null si autorizado; si no, la Response de error (401/500). */
export function checkApiToken(request: Request): Response | null {
  const expected = process.env.API_TOKEN
  if (!expected) {
    return Response.json(
      { error: 'API_TOKEN no está configurado en el servidor (.env.local)' },
      { status: 500 },
    )
  }

  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (!match) {
    return Response.json(
      { error: 'Falta la cabecera Authorization: Bearer <token>' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    )
  }

  const given = createHash('sha256').update(match[1]!).digest()
  const wanted = createHash('sha256').update(expected).digest()
  if (!timingSafeEqual(given, wanted)) {
    return Response.json({ error: 'Token inválido' }, { status: 401 })
  }
  return null
}
