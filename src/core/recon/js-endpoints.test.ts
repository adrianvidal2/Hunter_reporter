import { describe, expect, it } from 'vitest'
import { buildOpenApi, extractEndpoints } from './js-endpoints'

describe('extractEndpoints (literales de alta precisión)', () => {
  it('fetch con literal GET y con options method POST → endpoints correctos', () => {
    const model = extractEndpoints([
      {
        name: 'app.js',
        content: [
          `fetch("/api/users")`,
          `fetch('/api/login', { method: "POST", body: JSON.stringify({ user, pass }) })`,
          `fetch(\`/api/status\`)`,
        ].join('\n'),
      },
    ])
    expect(model.endpoints).toHaveLength(3)
    const get = model.endpoints.find((e) => e.path === '/api/users')!
    expect(get).toMatchObject({ method: 'get', path: '/api/users', queryParams: [] })
    const post = model.endpoints.find((e) => e.path === '/api/login')!
    expect(post).toMatchObject({ method: 'post', from: ['app.js'] })
    expect(model.gaps).toHaveLength(0)
  })

  it('query params literales se detectan y deduplican; el mismo endpoint en dos ficheros une `from`', () => {
    const model = extractEndpoints([
      { name: 'a.js', content: `fetch("/api/search?q=1&lang=es")` },
      { name: 'b.js', content: `fetch("/api/search?q=1&page=2")` },
    ])
    expect(model.endpoints).toHaveLength(1)
    expect(model.endpoints[0]).toMatchObject({ path: '/api/search', queryParams: ['q', 'lang', 'page'] })
    expect(model.endpoints[0]!.from.sort()).toEqual(['a.js', 'b.js'])
  })

  it('axios con método nombrado, axios objeto y XHR .open', () => {
    const model = extractEndpoints([
      {
        name: 'api.js',
        content: [
          `axios.post("/api/v1/login", { user })`,
          `axios.get("/api/v1/items")`,
          `axios({ url: "/api/v1/upload", method: "PUT", data: { name: 1, size: 2 } })`,
          `xhr.open("DELETE", "/api/v1/items/9")`,
          `request.open("PATCH", "/api/v1/notes/1")`,
        ].join('\n'),
      },
    ])
    const byKey = new Map(model.endpoints.map((e) => [`${e.method} ${e.path}`, e]))
    expect(byKey.get('post /api/v1/login')).toBeDefined()
    expect(byKey.get('get /api/v1/items')).toBeDefined()
    expect(byKey.get('put /api/v1/upload')?.bodyProps).toEqual(['name', 'size'])
    expect(byKey.get('delete /api/v1/items/9')).toBeDefined()
    expect(byKey.get('patch /api/v1/notes/1')).toBeDefined()
    expect(model.gaps).toHaveLength(0)
  })

  it('URL absoluta http(s) → path (la base va al servers del documento)', () => {
    const model = extractEndpoints([{ name: 'a.js', content: `fetch("https://api.ejemplo.com/v2/health")` }])
    expect(model.endpoints[0]).toMatchObject({ method: 'get', path: '/v2/health' })
  })

  it('LO DINÁMICO no se adivina: plantilla con ${} y concatenación van a gaps', () => {
    const model = extractEndpoints([
      {
        name: 'dyn.js',
        content: [
          'fetch(`/api/users/${userId}`)',
          'fetch("/api/items/" + itemId)',
          'axios.get(`/api/x?y=${encodeURIComponent(y)}`)',
        ].join('\n'),
      },
    ])
    expect(model.endpoints).toHaveLength(0) // NADA inventado
    expect(model.gaps.length).toBeGreaterThanOrEqual(3)
    const reasons = model.gaps.map((g) => g.reason)
    expect(reasons).toContain('dynamic-template')
    expect(reasons).toContain('concatenation')
    for (const g of model.gaps) {
      expect(g.from).toBe('dyn.js')
      expect(g.snippet.length).toBeGreaterThan(0)
      expect(g.snippet.length).toBeLessThanOrEqual(160)
    }
  })

  it('ruta relativa SIN base y strings fuera de contexto de llamada → gap o nada (precisión)', () => {
    const model = extractEndpoints([
      {
        name: 'm.js',
        content: [
          `fetch("api/sin-barra")`, // relativa sin base: no se adivina el origen
          `const plantilla = "/api/no-es-una-llamada"`, // string fuera de fetch/axios/xhr: NADA
          `window.open("/tampoco")`,
        ].join('\n'),
      },
    ])
    expect(model.endpoints).toHaveLength(0)
    expect(model.gaps).toHaveLength(1)
    expect(model.gaps[0]).toMatchObject({ reason: 'relative-no-base' })
  })
})

describe('buildOpenApi (documento honesto)', () => {
  it('paths/parameters/operationId/x-recon correctos; serverUrl opcional', () => {
    const model = extractEndpoints([
      { name: 'a.js', content: `fetch("/api/search?q=1&lang=es", { method: "POST", body: JSON.stringify({ term: 1 }) })` },
    ])
    const doc = buildOpenApi(model, { title: 'API de demo', serverUrl: 'https://app.ejemplo.com' }) as {
      openapi: string
      info: { title: string; description: string }
      servers: { url: string }[]
      paths: Record<string, Record<string, { operationId: string; parameters: unknown[]; requestBody?: object; 'x-recon': { from: string[] }; description: string }>>
    }

    expect(doc.openapi).toBe('3.0.3')
    expect(doc.info.title).toBe('API de demo')
    expect(doc.info.description).toMatch(/cobertura PARCIAL/i)
    expect(doc.servers?.[0]?.url).toBe('https://app.ejemplo.com')

    const post = doc.paths['/api/search'].post
    expect(post.operationId).toBe('post_api_search')
    expect(post.description).toMatch(/SIN verificar/i)
    expect(post['x-recon'].from).toEqual(['a.js'])
    const params = post.parameters as { name: string; in: string }[]
    expect(params.map((p) => p.name)).toEqual(['q', 'lang'])
    expect(params.every((p) => p.in === 'query')).toBe(true)
    expect(post.requestBody).toBeDefined()
  })

  it('modelo vacío → documento con paths vacíos (sin inventar nada)', () => {
    const doc = buildOpenApi({ endpoints: [], gaps: [] }) as { paths: object }
    expect(doc.paths).toEqual({})
  })
})
