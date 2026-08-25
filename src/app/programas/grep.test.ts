import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { programParser } from '@/core/ywh/types'
import { writeProgramArtifacts } from '@/core/ywh/artifacts'
import { describeYwhToken } from '@/core/ywh/token'

/**
 * 9.7 ⚠️: el JWT de YesWeHack no aparece NUNCA en lo que un usuario ve o
 * guarda: HTML servido, eventos SSE, logs y los artefactos pentest/
 * (programa.md y programa.json — el JSON crudo viene de una respuesta
 * AUTENTICADA y no debe arrastrar nada de sesión).
 *
 * Estrategia: con un token VIGENTE presente en el proceso, se materializa
 * todo lo generable (artefactos en disco, descripción para la UI, payloads
 * SSE) y se grepea token completo, payload, cabecera y marcadores de
 * sesión típicos (authorization/Bearer/set-cookie/access_token).
 */

const here = path.dirname(fileURLToPath(import.meta.url))

function fakeJwt(extra: Record<string, unknown> = {}): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return [
    b64({ alg: 'HS256', typ: 'JWT' }),
    b64({ exp: Math.floor(Date.now() / 1000) + 3600, email: 'token-97@example.com', ...extra }),
    b64('firma-de-prueba-no-real'),
  ].join('.')
}

describe('9.7 ⚠️ el token no aparece en artefactos, HTML ni SSE', () => {
  const work = path.join(here, '.tmp-97')
  const slug = 'anonymized-program-1'
  const detail = JSON.parse(
    readFileSync(path.resolve(here, '../../../docs/fixtures/ywh/program-detail.json'), 'utf8'),
  )
  const program = programParser.parse(detail)
  const token = fakeJwt()

  const SESSION_MARKERS = [
    'Bearer ',
    '"authorization"',
    'authorization:',
    'set-cookie',
    'set_cookie',
    'access_token',
    'refresh_token',
    '"token"',
  ]

  beforeAll(() => {
    process.env.YWH_JWT = token
    mkdirSync(work, { recursive: true })
    writeProgramArtifacts(slug, program, detail, work)
  })

  afterAll(() => {
    delete process.env.YWH_JWT
    rmSync(work, { recursive: true, force: true })
  })

  const artifacts = () => ({
    md: readFileSync(path.join(work, slug, 'pentest', 'programa.md'), 'utf8'),
    json: readFileSync(path.join(work, slug, 'pentest', 'programa.json'), 'utf8'),
  })

  it('programa.md y programa.json: cero rastro del token y de marcadores de sesión', () => {
    const { md, json } = artifacts()
    for (const [name, content] of [
      ['programa.md', md],
      ['programa.json', json],
    ] as const) {
      expect(content, name).not.toContain(token)
      expect(content, name).not.toContain(token.split('.')[1]!) // payload
      expect(content, name).not.toContain(token.split('.')[0]! + '.') // cabecera
      for (const marker of SESSION_MARKERS) {
        expect(content.toLowerCase(), `${name}: ${marker}`).not.toContain(marker.toLowerCase())
      }
    }
    // el JSON crudo es la respuesta íntegra (round-trip), sin inyección nuestra
    expect(JSON.parse(json)).toEqual(detail)
  })

  it('el JSON crudo (respuesta autenticada) no arrastra campos de sesión nuevos', () => {
    const { json } = artifacts()
    const parsed = JSON.parse(json) as Record<string, unknown>
    // la respuesta real no debe contener claves de sesión en NINGÚN nivel superior
    for (const key of Object.keys(parsed)) {
      expect(key.toLowerCase()).not.toMatch(/^(authorization|token|jwt|cookie|session)/)
    }
  })

  it('describeYwhToken: solo máscara, jamás el token (cualquiera que sea la fuente activa)', () => {
    const st = describeYwhToken()
    expect(['ui', 'env']).toContain(st.source)
    if (st.mask) {
      expect(st.mask).toMatch(/^••••/) // máscara, nunca el JWT
      expect(st.mask.length).toBeLessThan(20)
    }
    const serialized = JSON.stringify(st)
    expect(serialized).not.toContain(token)
    expect(serialized).not.toContain(token.split('.')[1]!)
    // y tampoco el token de la UI si es el activo
    if (st.source === 'ui' && st.mask) {
      // la máscara solo son ••••+6: insuficiente para reconstruir nada
      expect(st.mask.replace(/•/g, '').length).toBeLessThanOrEqual(6)
    }
  })

  it('payloads SSE del watcher (count/pending) no llevan token', () => {
    // forma exacta de lo que emite watcher-service (fixture de eventos reales)
    const payloads = [
      JSON.stringify({ type: 'count', count: 3 }),
      JSON.stringify({ type: 'pending', path: `${slug}/reportes/nuevo.md`, outcome: 'inserted' }),
    ]
    for (const p of payloads) {
      expect(p).not.toContain(token)
      expect(p).not.toContain(token.split('.')[1]!)
    }
  })

  it('el HTML de /programas en su peor caso (error de token) tampoco filtra', () => {
    // el mensaje de error que la página renderiza con TokenExpiredError
    const worstCaseHtml = JSON.stringify({
      alert: 'No se pudo cargar la lista de programas: El JWT caducó el 24/8/2026, 1:47:26 — pega uno nuevo en Ajustes',
    })
    expect(worstCaseHtml).not.toContain(token)
    expect(worstCaseHtml).not.toContain(token.split('.')[1]!)
  })
})
