import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ REPORTS_ROOT: env.root }) }))

import { POST } from './route'

const root = mkdtempSync(path.join(tmpdir(), 'deliver-route-'))

beforeAll(() => {
  env.root = root
  mkdirSync(path.join(root, 'demo', 'REPORTES_YWH'), { recursive: true })
  // ya existe uno con el mismo nombre (para probar colisión vía HTTP)
  writeFileSync(path.join(root, 'demo', 'REPORTES_YWH', 'informe.pdf'), '%PDF-1.7\nviejo\n')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const pdf = (content: string) => new File([`%PDF-1.7\n${content}\n`], 'informe.pdf', { type: 'application/pdf' })
const falso = () => new File(['<html>no soy pdf</html>'], 'falso.pdf', { type: 'application/pdf' })

function request(project: string, files: File[]): Request {
  const form = new FormData()
  for (const f of files) form.append('files', f)
  return new Request(`http://localhost/api/projects/${project}/deliver`, { method: 'POST', body: form })
}

describe('POST /api/projects/[project]/deliver', () => {
  it('subida de VARIOS con uno fallando: los demás entran e informe por fichero', async () => {
    const res = await POST(request('demo', [pdf('nuevo contenido'), falso(), pdf('otro más')]), {
      params: Promise.resolve({ project: 'demo' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: { ok: boolean; name?: string; renamed?: boolean; error?: string }[] }
    expect(body.results).toHaveLength(3)

    // 1: colisión con el existente → renombrado a " (2)", el viejo intacto
    expect(body.results[0]).toMatchObject({ ok: true, name: 'informe (2).pdf', renamed: true })
    // 2: no es PDF → falla con motivo claro
    expect(body.results[1]).toMatchObject({ ok: false })
    expect(body.results[1]!.error).toMatch(/%PDF-/)
    // 3: colisión doble (el existente + el recién creado) → " (3)"
    expect(body.results[2]).toMatchObject({ ok: true, name: 'informe (3).pdf', renamed: true })

    expect(readFileSync(path.join(root, 'demo', 'REPORTES_YWH', 'informe.pdf'), 'utf8')).toContain('viejo')
    expect(readFileSync(path.join(root, 'demo', 'REPORTES_YWH', 'informe (2).pdf'), 'utf8')).toContain('nuevo contenido')
    expect(existsSync(path.join(root, 'demo', 'REPORTES_YWH', 'falso.pdf'))).toBe(false)
  })

  it('proyecto inexistente → 404', async () => {
    const res = await POST(request('no-existe', [pdf('x')]), {
      params: Promise.resolve({ project: 'no-existe' }),
    })
    expect(res.status).toBe(404)
  })

  it('sin ficheros → 400', async () => {
    const res = await POST(request('demo', []), { params: Promise.resolve({ project: 'demo' }) })
    expect(res.status).toBe(400)
  })
})
