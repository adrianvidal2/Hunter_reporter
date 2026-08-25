import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { decryptWithKey, encryptWithKey, getOrCreateMasterKey } from '../../lib/secrets'
import { settingsDir } from '../llm/settings'

/**
 * Token de YesWeHack (9.3): JWT de sesión pegado a mano (checkpoint 9.0
 * ajustado; el PAT no estaba disponible en la cuenta).
 *
 * Precedencia documentada (docs/ywh-api.md):
 *   1. UI → `.settings/ywh.json` (JWT cifrado AES-256-GCM, infra del 8.1)
 *   2. arranque → `YWH_JWT` de `.env.local` (solo si el fichero no existe)
 *
 * Detección de expiración ANTES de llamar: se decodifica el claim `exp`
 * del payload (base64url, local, sin red). Caducado → TokenExpiredError.
 */

function ywhFile(): string {
  return path.join(settingsDir(), 'ywh.json')
}

export type YwhTokenSource = 'ui' | 'env'

export interface YwhToken {
  jwt: string
  source: YwhTokenSource
}

/** Decodifica el payload de un JWT SIN verificar firma (solo lectura local). */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

/** exp en segundos Unix, o null si el token no lo lleva. */
export function decodeJwtExp(jwt: string): number | null {
  const payload = decodeJwtPayload(jwt)
  const exp = payload?.exp
  return typeof exp === 'number' ? exp : null
}

/** El JWT está caducado según su claim exp (o mal formado). */
export class TokenExpiredError extends Error {
  constructor(public expiredAt: Date | null) {
    super(
      expiredAt
        ? `El JWT de YesWeHack caducó el ${expiredAt.toLocaleString('es')} — pega uno nuevo en Ajustes`
        : 'El token de YesWeHack no tiene un formato JWT válido — pega uno nuevo en Ajustes',
    )
    this.name = 'TokenExpiredError'
  }
}

/**
 * Lanza TokenExpiredError si el JWT está caducado o mal formado.
 * Sin claim exp: no se puede saber localmente → se deja pasar (la API
 * responderá 401 si toca).
 */
export function assertTokenValid(jwt: string, nowMs: number = Date.now()): void {
  const exp = decodeJwtExp(jwt)
  if (exp === null) {
    if (decodeJwtPayload(jwt) === null) throw new TokenExpiredError(null)
    return
  }
  if (exp * 1000 <= nowMs) throw new TokenExpiredError(new Date(exp * 1000))
}

/** Carga con precedencia ui > env. Null si no hay token en ningún sitio. */
export function loadYwhToken(): YwhToken | null {
  const file = ywhFile()
  if (existsSync(file)) {
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as { jwtEnc?: string }
      if (stored.jwtEnc) {
        return { jwt: decryptWithKey(getOrCreateMasterKey(settingsDir()), stored.jwtEnc), source: 'ui' }
      }
    } catch (err) {
      console.error('loadYwhToken: fichero corrupto, se ignora:', err)
    }
  }
  const env = process.env.YWH_JWT?.trim()
  if (env) return { jwt: env, source: 'env' }
  return null
}

/** Guarda el JWT (valida forma mínima de JWT y cifra). */
export function saveYwhToken(jwt: string): void {
  const clean = jwt.trim()
  if (clean.split('.').length !== 3 || decodeJwtPayload(clean) === null) {
    throw new Error('Eso no parece un JWT (se esperaban 3 partes decodificables)')
  }
  mkdirSync(settingsDir(), { recursive: true })
  writeFileSync(
    ywhFile(),
    JSON.stringify({ jwtEnc: encryptWithKey(getOrCreateMasterKey(settingsDir()), clean) }, null, 2) + '\n',
    { mode: 0o600 },
  )
}

/** Revocación local: borra el fichero cifrado (el .env sigue como fallback). */
export function clearYwhToken(): void {
  rmSync(ywhFile(), { force: true })
}

/** Estado para la UI — JAMÁS incluye el token, solo máscara y caducidad. */
export interface YwhTokenStatus {
  source: YwhTokenSource | null
  expiresAt: string | null
  expired: boolean
  mask: string | null
}

export function describeYwhToken(nowMs: number = Date.now()): YwhTokenStatus {
  const t = loadYwhToken()
  if (!t) return { source: null, expiresAt: null, expired: false, mask: null }
  const exp = decodeJwtExp(t.jwt)
  return {
    source: t.source,
    expiresAt: exp ? new Date(exp * 1000).toISOString() : null,
    expired: exp !== null && exp * 1000 <= nowMs,
    mask: `••••${t.jwt.slice(-6)}`,
  }
}
