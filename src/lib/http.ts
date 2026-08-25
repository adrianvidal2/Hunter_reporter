/**
 * Lectura de bodies JSON con tope de tamaño (paso 5.5).
 *
 * Doble defensa: si el cliente declara Content-Length mayor que el límite,
 * se rechaza SIN leer; si no lo declara (chunked), se va contando mientras
 * se lee y se corta al superarlo. Nunca se carga en memoria un body
 * descontrolado.
 */

export const MAX_BODY_BYTES = 2 * 1024 * 1024 // 2 MB

export type BodyResult =
  | { ok: true; data: unknown }
  | { ok: false; status: 413 | 400; error: string }

export async function readJsonBody(request: Request): Promise<BodyResult> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: `El cuerpo supera el límite de 2 MB` }
  }

  let text: string
  const reader = request.body?.getReader()
  if (reader) {
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        return { ok: false, status: 413, error: 'El cuerpo supera el límite de 2 MB' }
      }
      chunks.push(value)
    }
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    text = new TextDecoder().decode(merged)
  } else {
    text = await request.text()
  }

  try {
    return { ok: true, data: JSON.parse(text) }
  } catch {
    return { ok: false, status: 400, error: 'Cuerpo JSON inválido' }
  }
}
