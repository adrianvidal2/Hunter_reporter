import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFixture } from '../../../../test/fixtures/fixture'

// getEnv real está memoizado; aquí el root cambia por test.
const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ REPORTS_ROOT: env.root }),
}))

import { GET } from './route'

const call = (p: string) =>
  GET(new Request(`http://localhost/api/files/raw?path=${encodeURIComponent(p)}`))

describe('GET /api/files/raw', () => {
  let fx: ReturnType<typeof createFixture>

  beforeEach(() => {
    fx = createFixture()
    env.root = fx.root
    return () => fx.cleanup()
  })

  it('PDF válido → 200 con nosniff, inline, tipo correcto y bytes exactos', async () => {
    const res = await call('demo_project/REPORTES_YWH/informe-xss-reflejado.pdf')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/)
    expect(res.headers.get('content-length')).toBe(String(readFileSync(fx.pdf).length))
    expect(Buffer.from(await res.arrayBuffer())).toEqual(readFileSync(fx.pdf))
  })

  it('ruta fuera del root → 400 con mensaje (también codificada como %2e%2e%2f)', async () => {
    const res = await call('../../etc/passwd')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/fuera de REPORTS_ROOT/)

    const encoded = await call('%2e%2e%2fetc%2fpasswd')
    expect(encoded.status).toBe(400)
  })

  it('markdown se sirve como text/markdown; sin parámetro → 400; inexistente → 404', async () => {
    const md = await call('demo_project/reportes/informe-idor.md')
    expect(md.status).toBe(200)
    expect(md.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(await md.text()).toContain('severity: critical')

    const missingParam = await GET(new Request('http://localhost/api/files/raw'))
    expect(missingParam.status).toBe(400)

    const missing = await call('demo_project/reportes/no-existe.md')
    expect(missing.status).toBe(404)
  })

  it('extensión desconocida → application/octet-stream con nosniff', async () => {
    writeFileSync(path.join(fx.draftsDir, 'blob.bin'), Buffer.from([0x00, 0x01]))
    const res = await call('demo_project/reportes/blob.bin')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })
})
