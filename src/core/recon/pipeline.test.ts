import { describe, expect, it } from 'vitest'
import { classifyScope, extractPipelineItems, hostInScope, intersectWithScope, planPipeline } from './pipeline'

describe('planPipeline (forma del plan según el scope)', () => {
  it('scope solo wildcard → incluye enumeración (subfinder → dnsx); httpx consume su salida', () => {
    const res = planPipeline(['*.ejemplo.com'])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.plan.stages.map((s) => s.toolId)).toEqual(['subfinder', 'dnsx', 'httpx', 'katana', 'gf', 'nuclei'])
    expect(res.plan.stages[0]).toMatchObject({ toolId: 'subfinder', source: 'scope', targets: ['ejemplo.com'] })
    expect(res.plan.stages[1]).toMatchObject({ toolId: 'dnsx', source: 'prev' })
    expect(res.plan.stages[2]).toMatchObject({ toolId: 'httpx', source: 'prev' })
  })

  it('scope solo host concreto → SIN enumeración: arranca en httpx con el host', () => {
    const res = planPipeline(['api.ejemplo.com'])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.plan.stages.map((s) => s.toolId)).toEqual(['httpx', 'katana', 'gf', 'nuclei'])
    expect(res.plan.stages[0]).toMatchObject({ toolId: 'httpx', source: 'scope', targets: ['api.ejemplo.com'] })
  })

  it('scope mixto → enumera SOLO las ramas wildcard; httpx une enumeración + hosts concretos', () => {
    const res = planPipeline(['*.ejemplo.com', 'api.otro.com'])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const subfinder = res.plan.stages.find((s) => s.toolId === 'subfinder')
    expect(subfinder?.targets).toEqual(['ejemplo.com']) // no arrastra api.otro.com a la enumeración
    const httpx = res.plan.stages.find((s) => s.toolId === 'httpx')
    expect(httpx).toMatchObject({ source: 'union', targets: ['api.otro.com'] })
  })

  it('scope vacío → error claro', () => {
    const res = planPipeline([])
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toMatch(/scope/i)
  })

  it('solo URLs en scope → ruta correcta hacia sqlmap/dalfox, sin lane de hosts', () => {
    const res = planPipeline(['https://app.ejemplo.com/login'])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.plan.stages.map((s) => s.toolId)).toEqual(['sqlmap', 'dalfox'])
    for (const s of res.plan.stages) {
      expect(s.source).toBe('scope')
      expect(s.targets).toEqual(['app.ejemplo.com/login'])
      expect(s.gated).toBe(true) // explotación: SIEMPRE pasa por el gate
    }
  })

  it('wildcard + host + URLs → las dos lanes, URLs solo a explotación (nunca se convierten en hosts)', () => {
    const res = planPipeline(['*.ejemplo.com', 'api.otro.com', 'https://app.ejemplo.com/login'])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.plan.stages.map((s) => s.toolId)).toEqual([
      'subfinder', 'dnsx', 'httpx', 'katana', 'gf', 'nuclei', 'sqlmap', 'dalfox',
    ])
    expect(res.plan.shape.wildcards).toEqual(['ejemplo.com'])
    expect(res.plan.shape.hosts).toEqual(['api.otro.com'])
    expect(res.plan.shape.urls).toEqual(['app.ejemplo.com/login'])
  })

  it('solo wildcards + URLs: httpx en modo prev (sin hosts concretos que unir)', () => {
    const res = planPipeline(['*.ejemplo.com', 'https://app.ejemplo.com/login'])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const httpx = res.plan.stages.find((s) => s.toolId === 'httpx')
    expect(httpx).toMatchObject({ source: 'prev', targets: [] })
  })

  it('entradas inválidas → ignoradas con transparencia; si no queda nada aprovechable → error', () => {
    const res = planPipeline(['no es un dominio', 'otro mal'])
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toMatch(/aprovechable/i)

    const res2 = planPipeline(['*.ejemplo.com', 'malVarChar!!'])
    expect(res2.ok).toBe(true)
    if (!res2.ok) return
    expect(res2.plan.shape.invalid).toEqual(['malVarChar!!'])
    expect(res2.plan.stages.map((s) => s.toolId)).toContain('subfinder') // el plan sigue con lo válido
  })

  it('flags de gate: nuclei/sqlmap/dalfox las piden; enumeración/httpx/crawl/gf no', () => {
    const res = planPipeline(['*.ejemplo.com', 'https://app.ejemplo.com/login'])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(Object.fromEntries(res.plan.stages.map((s) => [s.toolId, s.gated]))).toEqual({
      subfinder: false, dnsx: false, httpx: false, katana: false, gf: false,
      nuclei: true, sqlmap: true, dalfox: true,
    })
  })
})

describe('classifyScope (formas del scope)', () => {
  it('clasifica wildcards (sin *.), hosts y URLs; deduplica', () => {
    const shape = classifyScope(['*.Ejemplo.com/', 'api.ejemplo.com', 'https://app.ejemplo.com/login', '*.ejemplo.com'])
    expect(shape.wildcards).toEqual(['ejemplo.com'])
    expect(shape.hosts).toEqual(['api.ejemplo.com'])
    expect(shape.urls).toEqual(['app.ejemplo.com/login'])
    expect(shape.invalid).toEqual([])
  })
})

describe('hostInScope / intersectWithScope (nada fuera de scope se cuela)', () => {
  const scope = ['*.ejemplo.com', 'api.otro.com', 'https://app.ejemplo.com/login']

  it('host exacto o subdominio de un wildcard DECLARADO → dentro; apex y extraños → fuera', () => {
    expect(hostInScope('dev.ejemplo.com', scope)).toBe(true)
    expect(hostInScope('a.b.ejemplo.com', scope)).toBe(true) // subdominio profundo
    expect(hostInScope('api.otro.com', scope)).toBe(true)
    expect(hostInScope('ejemplo.com', scope)).toBe(false) // apex de wildcard: NO se da por incluido
    expect(hostInScope('otro.com', scope)).toBe(false)
    expect(hostInScope('evildoer.com', scope)).toBe(false)
    expect(hostInScope('-dev.ejemplo.com', scope)).toBe(false) // jamás un flag disfrazado
  })

  it('intersectWithScope: hosts y URLs por SU HOST; únicas, en orden, caja preservada', () => {
    const items = [
      'dev.ejemplo.com',
      'https://dev.ejemplo.com/ruta?x=1',
      'fuera.com',
      'https://fuera.com/x',
      'api.otro.com',
      'dev.ejemplo.com', // duplicado
      'api.otro.com:8080/admin', // host con puerto
      '',
    ]
    expect(intersectWithScope(items, scope)).toEqual([
      'dev.ejemplo.com',
      'https://dev.ejemplo.com/ruta?x=1',
      'api.otro.com',
      'api.otro.com:8080/admin',
    ])
  })

  it('flags disfrazados no pasan la intersección aunque imiten hosts', () => {
    expect(intersectWithScope(['-oN', '--dump', '-'], scope)).toEqual([])
  })
})

describe('extractPipelineItems (aristas entre etapas)', () => {
  it('salida de subfinder/dnsx/httpx → hosts', () => {
    expect(extractPipelineItems('subfinder', 'dev.ejemplo.com\nhttps://api.ejemplo.com/x\n')).toEqual([
      'dev.ejemplo.com', 'api.ejemplo.com',
    ])
    expect(extractPipelineItems('dnsx', 'dev.ejemplo.com\n')).toEqual(['dev.ejemplo.com'])
  })

  it('salida de katana (JSON -jc) y gf → URLs', () => {
    const katana = [
      '{"timestamp":"2026-01-01T10:00:00Z","method":"GET","url":"https://dev.ejemplo.com/a"}',
      '{"method":"GET","url":"https://dev.ejemplo.com/b","source":"crawl"}',
    ].join('\n')
    expect(extractPipelineItems('katana', katana)).toEqual(['https://dev.ejemplo.com/a', 'https://dev.ejemplo.com/b'])
    expect(extractPipelineItems('gf', 'https://dev.ejemplo.com/a?q=1\nbasura\n')).toEqual(['https://dev.ejemplo.com/a?q=1'])
  })

  it('etapa terminal o herramienta sin aristas → null (nada que alimentar)', () => {
    expect(extractPipelineItems('nuclei', '{"template-id":"xss"}')).toBeNull()
    expect(extractPipelineItems('nmap', '80/tcp open http')).toBeNull()
    expect(extractPipelineItems('sqlmap', 'parameters')).toBeNull()
    expect(extractPipelineItems('rm-rf', 'x')).toBeNull()
  })
})
