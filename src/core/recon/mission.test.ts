import { describe, expect, it } from 'vitest'
import { buildMission, DEFAULT_MISSION_TEMPLATE, type MissionData } from './mission'

const DATA: MissionData = {
  project: 'demo',
  scope: ['*.ejemplo.com', 'api.ejemplo.com'],
  openapiJson: '{"openapi":"3.0.3","paths":{"/api/v1/users/{id}":{"get":{}}}}',
  primitivas: [
    { kind: 'bola-idor' as const, target: 'GET /api/v1/users/{id}', signal: 'Parámetro de id en la ruta.' },
  ],
  hipotesis: [
    { title: 'BOLA en users', kind: 'bola' as const, target: 'GET /api/v1/users/{id}', probabilidad: 0.9, razon: 'id secuencial' },
  ],
  secretos: [{ kind: 'aws-access-key', value: 'AKIAQWMHXN3FAKEKEY99', confidence: 'candidato' }],
  huecos: [{ reason: 'dynamic-template', snippet: 'fetch(`/api/users/${id}`)', from: 'x.ts' }],
  jsSinMap: ['https://app.ejemplo.com/static/app.min.js'],
}

describe('buildMission (ensamblar ≠ ejecutar)', () => {
  it('incluye EXACTAMENTE los datos dados: openapi, primitivas, hipótesis, secretos, huecos', () => {
    const mission = buildMission(DATA)
    expect(mission).toContain('## Misión: auditoría del JS de demo')
    expect(mission).toContain('`*.ejemplo.com`')
    expect(mission).toContain('"openapi":"3.0.3"')
    expect(mission).toContain('**bola-idor** → `GET /api/v1/users/{id}`')
    expect(mission).toContain('BOLA en users')
    expect(mission).toContain('90%)')
    expect(mission).toContain('AKIAQWMHXN3FAKEKEY99')
    // los HUECOS señalados explícitamente (el foco del agente)
    expect(mission).toContain('[dynamic-template]')
    expect(mission).toContain('fetch(`/api/users/${id}`)')
    expect(mission).toContain('[js-sin-sourcemap]')
    expect(mission).toContain('https://app.ejemplo.com/static/app.min.js')
  })

  it('la sección de HUECOS existe siempre y la plantilla trae las reglas del prompt real', () => {
    const mission = buildMission({ project: 'vacio', scope: [], primitivas: [], hipotesis: [], secretos: [], huecos: [] })
    expect(mission).toContain('### HUECOS')
    expect(mission).toMatch(/sin datos para esta sección/i)
    // reglas inviolables del prompt real, siempre presentes
    expect(mission).toContain('NUNCA borres cuentas')
    expect(mission).toContain('Fuera del scope declarado arriba, NADA')
    expect(mission).toContain('verifícalos antes de creerlos')
  })

  it('ensamblar ≠ ejecutar: la misión NO contiene instrucciones destructivas y no lanza nada', () => {
    const mission = buildMission(DATA)
    // el plan de prueba explícitamente SOLO lectura
    expect(mission).toMatch(/SOLO lectura/i)
    expect(mission).not.toMatch(/borra la cuenta|DELETE masivo sin más/i)
    // buildMission es puro: devuelve texto, no promesa de lanzamiento
    expect(typeof mission).toBe('string')
  })

  it('los placeholders se consumen: sin {{clave}} residual con datos completos', () => {
    const mission = buildMission(DATA)
    expect(mission).not.toContain('{{')
  })

  it('plantilla editable: una plantilla mínima renderiza solo lo suyo', () => {
    const custom = 'Misión de {{proyecto}} sobre {{huecos}}'
    const mission = buildMission(DATA, custom)
    expect(mission).toBe(
      'Misión de demo sobre - [dynamic-template] `fetch(`/api/users/${id}`)`\n' +
        '- [js-sin-sourcemap] `https://app.ejemplo.com/static/app.min.js`',
    )
  })

  it('DEFAULT_MISSION_TEMPLATE cubre el prompt real (OpenAPI, secretos, SQLi, DOM, reglas)', () => {
    expect(DEFAULT_MISSION_TEMPLATE).toContain('{{openapi}}')
    expect(DEFAULT_MISSION_TEMPLATE).toContain('{{primitivas}}')
    expect(DEFAULT_MISSION_TEMPLATE).toContain('{{hipotesis}}')
    expect(DEFAULT_MISSION_TEMPLATE).toContain('{{secretos}}')
    expect(DEFAULT_MISSION_TEMPLATE).toContain('{{huecos}}')
    expect(DEFAULT_MISSION_TEMPLATE).toContain('SQLi')
    expect(DEFAULT_MISSION_TEMPLATE).toContain('playwright')
    expect(DEFAULT_MISSION_TEMPLATE).toContain('NUNCA borres cuentas')
  })
})
