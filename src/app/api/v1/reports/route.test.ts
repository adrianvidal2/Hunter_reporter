import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFixture } from '../../../../test/fixtures/fixture'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ REPORTS_ROOT: env.root }),
}))

import { POST, GET } from './route'

const TOKEN = 'token-de-test-para-la-bateria-5.3'

const post = (body: unknown, raw?: string, headers: Record<string, string> = {}) =>
  POST(
    new Request('http://localhost/api/v1/reports', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        ...headers,
      },
      body: raw ?? JSON.stringify(body),
    }),
  )

const get = (query = '', headers: Record<string, string> = {}) =>
  GET(new Request(`http://localhost/api/v1/reports${query}`, { headers: { authorization: `Bearer ${TOKEN}`, ...headers } }))

describe('POST /api/v1/reports', () => {
  let fx: ReturnType<typeof createFixture>

  beforeEach(() => {
    fx = createFixture()
    env.root = fx.root
    process.env.API_TOKEN = TOKEN
    return () => {
      fx.cleanup()
      delete process.env.API_TOKEN
    }
  })

  it('5.1: { content } mínimo → 201 y crea el fichero en _inbox/', async () => {
    const res = await post({ content: '# Reporte suelto\n\nPoC aquí.' })
    expect(res.status).toBe(201)

    const { path: relPath } = (await res.json()) as { path: string }
    expect(relPath).toMatch(/^_inbox\/report-\d{8}-\d{6}-[0-9a-f]{6}\.md$/)
    const abs = path.join(fx.root, relPath)
    expect(existsSync(abs)).toBe(true)
    expect(readFileSync(abs, 'utf8')).toBe('# Reporte suelto\n\nPoC aquí.')
  })

  it('5.2: filename + project → 201 en <project>/reportes/, saneado y con .md', async () => {
    const res = await post({
      content: 'contenido del informe',
      filename: 'informe-idor-nuevo',
      project: 'demo_project',
    })
    expect(res.status).toBe(201)
    expect((await res.json()) as { path: string }).toEqual({
      path: 'demo_project/reportes/informe-idor-nuevo.md',
    })
    expect(readFileSync(path.join(fx.draftsDir, 'informe-idor-nuevo.md'), 'utf8')).toBe(
      'contenido del informe',
    )
  })

  it("5.2: '../evil.md' rechazado (400) y no se escribe nada en ninguna parte", async () => {
    const before = readdirSync(fx.root).sort()

    const res = await post({ content: 'x', filename: '../evil.md' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/no puede contener separadores/i)

    const back = await post({ content: 'x', filename: '..\\..\\windows\\evil.md' })
    expect(back.status).toBe(400)

    expect(readdirSync(fx.root).sort()).toEqual(before) // ni _inbox ni nada nuevo
  })

  it('5.2: proyecto inexistente → 404 (también rutas raras en project)', async () => {
    const res = await post({ content: 'x', project: 'fantasma' })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/no existe/i)

    const escape = await post({ content: 'x', project: '../x' })
    expect(escape.status).toBe(404)
    expect(existsSync(path.join(fx.root, '_inbox'))).toBe(false) // no se creó _inbox
  })

  it('5.3: sin token → 401 con WWW-Authenticate; token malo → 401; bueno → 201', async () => {
    const sin = await post({ content: 'x' }, undefined, { authorization: '' })
    expect(sin.status).toBe(401)
    expect(sin.headers.get('www-authenticate')).toBe('Bearer')

    const malo = await post({ content: 'x' }, undefined, {
      authorization: 'Bearer incorrecto',
    })
    expect(malo.status).toBe(401)
    expect((await malo.json()).error).toMatch(/inválido/i)

    const bueno = await post({ content: 'x' })
    expect(bueno.status).toBe(201)
  })

  it('5.3: sin API_TOKEN configurado, la API queda cerrada (500)', async () => {
    delete process.env.API_TOKEN
    const res = await post({ content: 'x' })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/API_TOKEN no está configurado/)
  })

  it('colisión → 409 con overwrite:false y el fichero original queda intacto', async () => {
    const first = await post({ content: 'primera versión', filename: 'choque.md' })
    expect(first.status).toBe(201)

    const second = await post({ content: 'segunda versión', filename: 'choque.md', overwrite: false })
    expect(second.status).toBe(409)
    expect(readFileSync(path.join(fx.root, '_inbox', 'choque.md'), 'utf8')).toBe('primera versión')
  })

  it('5.4: colisión por defecto → sufijo " (2)", " (3)"… con el contenido de cada una', async () => {
    const one = await post({ content: 'v1', filename: 'choque.md' })
    const two = await post({ content: 'v2', filename: 'choque.md' })
    const three = await post({ content: 'v3', filename: 'choque.md' })

    expect(one.status).toBe(201)
    expect((await two.json()) as { path: string }).toEqual({ path: '_inbox/choque (2).md' })
    expect((await three.json()) as { path: string }).toEqual({ path: '_inbox/choque (3).md' })

    const inbox = path.join(fx.root, '_inbox')
    expect(readFileSync(path.join(inbox, 'choque.md'), 'utf8')).toBe('v1')
    expect(readFileSync(path.join(inbox, 'choque (2).md'), 'utf8')).toBe('v2')
    expect(readFileSync(path.join(inbox, 'choque (3).md'), 'utf8')).toBe('v3')
  })

  it('cuerpo inválido → 400 (JSON roto, content ausente, filename no string)', async () => {
    const broken = await post(undefined, '{esto no es json')
    expect(broken.status).toBe(400)

    const noContent = await post({ filename: 'x.md' })
    expect(noContent.status).toBe(400)

    const badFilename = await post({ content: 'x', filename: 42 })
    expect(badFilename.status).toBe(400)
  })

  it('5.5: 2 MB + 1 byte → 413; justo por debajo del límite → 201', async () => {
    const MB = 1024 * 1024
    const tooBig = await post({ content: 'x'.repeat(2 * MB + 1) })
    expect(tooBig.status).toBe(413)
    expect((await tooBig.json()).error).toMatch(/2 MB/)

    const fits = await post({ content: 'x'.repeat(2 * MB - 100) })
    expect(fits.status).toBe(201)
  })
})

describe('GET /api/v1/reports?project=', () => {
  let fx: ReturnType<typeof createFixture>

  beforeEach(() => {
    fx = createFixture()
    env.root = fx.root
    process.env.API_TOKEN = TOKEN
    return () => {
      fx.cleanup()
      delete process.env.API_TOKEN
    }
  })

  it('forma de respuesta: project + delivered/drafts con name, relPath, size, mtimeMs', async () => {
    const res = await get('?project=demo_project')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      project: string
      delivered: { name: string; relPath: string; size: number; mtimeMs: number }[]
      drafts: { name: string; relPath: string; size: number; mtimeMs: number }[]
    }
    expect(body.project).toBe('demo_project')
    expect(body.delivered.map((f) => f.name)).toEqual(['informe-xss-reflejado.pdf'])
    expect(body.drafts.map((f) => f.name)).toEqual(['borrador-sqli.md', 'informe-idor.md'])
    for (const f of [...body.delivered, ...body.drafts]) {
      expect(f.relPath.startsWith('demo_project/')).toBe(true)
      expect(f.size).toBeGreaterThan(0)
      expect(f.mtimeMs).toBeGreaterThan(0)
    }
  })

  it('sin ?project= → 400; proyecto inexistente → 404; sin token → 401', async () => {
    expect((await get('')).status).toBe(400)
    expect((await get('?project=fantasma')).status).toBe(404)
    expect((await get('?project=demo_project', { authorization: '' })).status).toBe(401)
  })
})
