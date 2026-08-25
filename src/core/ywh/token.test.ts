import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  TokenExpiredError,
  assertTokenValid,
  clearYwhToken,
  decodeJwtExp,
  describeYwhToken,
  loadYwhToken,
  saveYwhToken,
} from './token'

// Redirigir cwd a un tmpdir ANTES de importar el módulo (usa cwd/.settings)
const tmp = mkdtempSync(path.join(tmpdir(), 'ywh-token-'))
process.chdir(tmp)

/** JWT de mentira con exp configurable (firma irrelevante: no se verifica). */
function fakeJwt(expSeconds: number | null, extra: Record<string, unknown> = {}): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const payload = expSeconds === null ? { ...extra } : { exp: expSeconds, ...extra }
  return `${b64({ alg: 'none' })}.${b64(payload)}.firma-firma-firma`
}

describe('9.3 · expiración detectada EN LOCAL (sin red)', () => {
  it('token caducado → TokenExpiredError con la fecha de caducidad', () => {
    const caducado = fakeJwt(Math.floor(Date.now() / 1000) - 3600) // hace 1 h
    try {
      assertTokenValid(caducado)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(TokenExpiredError)
      expect((err as TokenExpiredError).expiredAt!.getTime()).toBe((Math.floor(Date.now() / 1000) - 3600) * 1000)
      expect((err as TokenExpiredError).message).toMatch(/caducó/)
    }
  })

  it('token vigente pasa; exp justo en el futuro pasa; borde exacto caduca', () => {
    expect(() => assertTokenValid(fakeJwt(Math.floor(Date.now() / 1000) + 300))).not.toThrow()
    expect(() => assertTokenValid(fakeJwt(null))).not.toThrow() // sin exp: no verificable
    const exacto = Math.floor(Date.now() / 1000)
    expect(() => assertTokenValid(fakeJwt(exacto), exacto * 1000)).toThrow(TokenExpiredError)
  })

  it('basura sin formato JWT → TokenExpiredError (formato inválido)', () => {
    expect(() => assertTokenValid('no-soy-un-jwt')).toThrow(/formato JWT/)
    expect(decodeJwtExp('a.b')).toBeNull()
  })

  it('describeYwhToken expone caducidad y máscara, nunca el token', () => {
    saveYwhToken(fakeJwt(Math.floor(Date.now() / 1000) - 10))
    const st = describeYwhToken()
    expect(st.source).toBe('ui')
    expect(st.expired).toBe(true)
    expect(st.mask).toMatch(/^••••/)
    expect(JSON.stringify(st)).not.toContain('firma-firma')
  })
})

describe('9.3 · guardado cifrado y precedencia ui > env', () => {
  beforeEach(() => clearYwhToken())

  it('sin fichero y sin env → null; env solo → source env', () => {
    delete process.env.YWH_JWT
    expect(loadYwhToken()).toBeNull()

    process.env.YWH_JWT = fakeJwt(null)
    expect(loadYwhToken()).toMatchObject({ source: 'env' })
    delete process.env.YWH_JWT
  })

  it('guardar → disco cifrado (nada en claro) y carga con source ui', () => {
    const jwt = fakeJwt(Math.floor(Date.now() / 1000) + 600, { email: 'x@y.z' })
    saveYwhToken(jwt)

    const raw = readFileSync(path.join(tmp, '.settings', 'ywh.json'), 'utf8')
    expect(raw).not.toContain(jwt)
    expect(raw).not.toContain('x@y.z')
    expect(raw).toContain('v1.') // ciphertext

    const loaded = loadYwhToken()
    expect(loaded).toEqual({ jwt, source: 'ui' })

    // con env TAMBIÉN presente, el fichero (ui) gana
    process.env.YWH_JWT = fakeJwt(null)
    expect(loadYwhToken()!.source).toBe('ui')
    delete process.env.YWH_JWT
  })

  it('clearYwhToken borra el fichero (el .env vuelve a mandar)', () => {
    saveYwhToken(fakeJwt(null))
    process.env.YWH_JWT = fakeJwt(Math.floor(Date.now() / 1000) + 60)
    expect(loadYwhToken()!.source).toBe('ui')
    clearYwhToken()
    expect(loadYwhToken()!.source).toBe('env')
    expect(existsSync(path.join(tmp, '.settings', 'ywh.json'))).toBe(false)
    delete process.env.YWH_JWT
  })

  it('guardar basura → error claro sin escribir', () => {
    expect(() => saveYwhToken('no-es-un-jwt')).toThrow(/no parece un JWT/)
    expect(loadYwhToken()).toBeNull()
  })
})

afterAll(() => {
  process.chdir(tmpdir())
  rmSync(tmp, { recursive: true, force: true })
})
