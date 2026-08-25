import { getWatcherService } from '@/server/watcher-service'

/**
 * GET /api/events (paso 6.3) — stream SSE de novedades.
 *
 * Eventos: `count` (contador actual de pendientes, también al conectar) y
 * `pending` (fichero detectado). Sin token: es el canal de la UI local
 * (EventSource no manda cabeceras y el servidor solo escucha en 127.0.0.1).
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const service = getWatcherService()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      let closed = false
      const send = (payload: unknown) => {
        if (closed) return
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`,
            ),
          )
        } catch {
          closed = true // el cliente se fue: lo detectará el abort
        }
      }

      const unsubscribe = service.subscribe(send)

      const onAbort = () => {
        closed = true
        unsubscribe()
        try {
          controller.close()
        } catch {
          // ya cerrado
        }
      }
      request.signal.addEventListener('abort', onAbort, { once: true })
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
