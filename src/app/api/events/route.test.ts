import { copyFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFixture, type Fixture } from '../../../test/fixtures/fixture'
import { closeWatcherService } from '@/server/watcher-service'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ REPORTS_ROOT: env.root }),
}))

import { GET } from './route'

/** Lee el stream SSE y acumula eventos hasta que `until(data)` devuelve true. */
class SseReader {
  private buffer = ''
  private events: { event: string; data: string }[] = []
  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {}

  static async open(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
    const reader = body.getReader()
    const sse = new SseReader(reader)
    void sse.pump(signal)
    return sse
  }

  private async pump(signal: AbortSignal) {
    try {
      for (;;) {
        if (signal.aborted) break
        const { done, value } = await this.reader.read()
        if (done) break
        this.buffer += new TextDecoder().decode(value)
        let idx: number
        while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
          const chunk = this.buffer.slice(0, idx)
          this.buffer = this.buffer.slice(idx + 2)
          const ev = /event: (.+)/.exec(chunk)?.[1]
          const data = /data: (.+)/.exec(chunk)?.[1]
          if (ev && data) this.events.push({ event: ev, data })
        }
      }
    } catch {
      // stream abortado
    }
  }

  async until(pred: (e: { event: string; data: string }) => boolean, ms = 5000) {
    const start = Date.now()
    for (;;) {
      const hit = this.events.find(pred)
      if (hit) return hit
      if (Date.now() - start > ms) throw new Error(`SSE: no llegó el evento esperado. Recibidos: ${JSON.stringify(this.events)}`)
      await new Promise((r) => setTimeout(r, 50))
    }
  }

  all() {
    return this.events
  }
}

describe('GET /api/events (SSE)', () => {
  let fx: Fixture
  let controller: AbortController
  let sse: SseReader

  beforeEach(() => {
    fx = createFixture()
    env.root = fx.root
    // El route crea el servicio con la BD por defecto: apuntarla al fixture
    // para no escribir en el índice real de la app.
    process.env.DB_PATH = path.join(fx.root, 'index.db')
    controller = new AbortController()
  })

  afterEach(async () => {
    controller.abort()
    await closeWatcherService(fx.root)
    delete process.env.DB_PATH
    fx.cleanup()
  })

  it('al conectar recibe el contador actual; un fichero NUEVO genera exactamente UN evento pending', async () => {
    const res = await GET(new Request('http://localhost/api/events', { signal: controller.signal }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)

    sse = await SseReader.open(res.body!, controller.signal)

    // El servicio singleton empieza a escuchar ya: esperar a que esté listo
    // antes de escribir (evita perder el evento en el escaneo inicial).
    const { getWatcherService } = await import('@/server/watcher-service')
    await getWatcherService(fx.root).ready

    const first = await sse.until((e) => e.event === 'count')
    expect(JSON.parse(first.data)).toEqual({ type: 'count', count: 0 })

    // cp de un .md (el escenario del plan)
    const dst = path.join(fx.draftsDir, 'sse-nuevo.md')
    copyFileSync(fx.mdFrontMatter, dst)

    const hit = await sse.until(
      (e) => e.event === 'pending' && e.data.includes('sse-nuevo.md'),
    )
    expect(JSON.parse(hit.data)).toEqual({
      type: 'pending',
      path: 'demo_project/reportes/sse-nuevo.md',
      outcome: 'inserted',
    })

    // Ventana para cazar duplicados (awaitWriteFinish + margen)
    await new Promise((r) => setTimeout(r, 800))
    const forFile = sse.all().filter((e) => e.event === 'pending' && e.data.includes('sse-nuevo.md'))
    expect(forFile).toHaveLength(1) // UN evento, no dos (singleton + debounce)

    // Y el contador se actualizó a 1
    const counts = sse
      .all()
      .filter((e) => e.event === 'count')
      .map((e) => JSON.parse(e.data).count)
    expect(counts).toContain(1)
  })

  it('más de un fichero: uno por fichero, y el contador acumula', async () => {
    const res = await GET(new Request('http://localhost/api/events', { signal: controller.signal }))
    sse = await SseReader.open(res.body!, controller.signal)
    const { getWatcherService } = await import('@/server/watcher-service')
    await getWatcherService(fx.root).ready

    writeFileSync(path.join(fx.draftsDir, 'a.md'), 'uno')
    writeFileSync(path.join(fx.draftsDir, 'b.md'), 'dos')

    await sse.until((e) => e.event === 'pending' && e.data.includes('a.md'))
    await sse.until((e) => e.event === 'pending' && e.data.includes('b.md'))
    await new Promise((r) => setTimeout(r, 600))

    const pendings = sse.all().filter((e) => e.event === 'pending')
    expect(pendings).toHaveLength(2)
    const counts = sse
      .all()
      .filter((e) => e.event === 'count')
      .map((e) => JSON.parse(e.data).count)
    expect(Math.max(...counts)).toBe(2)
  })
})
