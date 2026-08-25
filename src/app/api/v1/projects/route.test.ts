import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFixture } from '../../../../test/fixtures/fixture'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ REPORTS_ROOT: env.root }),
}))

import { GET } from './route'

const TOKEN = 'token-de-test-para-la-bateria-5.6'
const get = (headers: Record<string, string> = {}) =>
  GET(
    new Request('http://localhost/api/v1/projects', {
      headers: { authorization: `Bearer ${TOKEN}`, ...headers },
    }),
  )

describe('GET /api/v1/projects', () => {
  let fx: ReturnType<typeof createFixture>

  beforeEach(() => {
    fx = createFixture({ extraProjects: ['banco_demo'] })
    env.root = fx.root
    process.env.API_TOKEN = TOKEN
    return () => {
      fx.cleanup()
      delete process.env.API_TOKEN
    }
  })

  it('forma de respuesta: { projects: string[] } ordenadas', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect((await res.json()) as unknown).toEqual({
      projects: ['banco_demo', 'demo_project'],
    })
  })

  it('sin token → 401 (misma política que la ingesta)', async () => {
    const res = await get({ authorization: '' })
    expect(res.status).toBe(401)
  })
})
