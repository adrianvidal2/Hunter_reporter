import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { decryptWithKey, encryptWithKey, getOrCreateMasterKey } from '../../lib/secrets'
import { settingsDir } from '../llm/settings'

/**
 * Token de Intigriti (paso 3 del plan multiplataforma): PAT de larga
 * duración, OPACO — sin claim `exp` que decodificar. Por eso aquí NO hay
 * contador de caducidad como en YWH (9.3): la comprobación de validez es
 * «Probar conexión» (GET /v1/programs?limit=1) desde Ajustes, como el
 * botón de los providers LLM del 8.1.
 *
 * Precedencia (igual que YWH):
 *   1. UI → `.settings/intigriti.json` (PAT cifrado AES-256-GCM)
 *   2. arranque → `INTIGRITI_PAT` de `.env.local` (solo si no hay fichero)
 *
 * La API de Intigriti NO tiene endpoints públicos: sin token no hay
 * degradación a «solo públicos» — el cliente falla con auth.
 */

function intigritiFile(): string {
  return path.join(settingsDir(), 'intigriti.json')
}

export type IntigritiTokenSource = 'ui' | 'env'

export interface IntigritiToken {
  pat: string
  source: IntigritiTokenSource
}

/**
 * Limpia lo pegado: espacios y saltos de línea en los extremos Y también
 * dentro (un PAT es opaco y sin espacios; lo típico es pegarlo con un
 * salto de cola del password manager).
 */
export function cleanPat(raw: string): string {
  return raw.replace(/\s+/g, '')
}

/** Forma mínima: PAT de Intigriti ≈ 66 chars alfanuméricos sin espacios. */
export function assertPatShape(pat: string): void {
  if (pat.length < 20) {
    throw new Error('El PAT es demasiado corto — pega el token completo (perfil → API → researcher)')
  }
  if (/\s/.test(pat)) {
    throw new Error('El PAT no puede contener espacios ni saltos de línea')
  }
}

/** Carga con precedencia ui > env. Null si no hay token en ningún sitio. */
export function loadIntigritiToken(): IntigritiToken | null {
  const file = intigritiFile()
  if (existsSync(file)) {
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as { patEnc?: string }
      if (stored.patEnc) {
        return { pat: decryptWithKey(getOrCreateMasterKey(settingsDir()), stored.patEnc), source: 'ui' }
      }
    } catch (err) {
      console.error('loadIntigritiToken: fichero corrupto, se ignora:', err)
    }
  }
  const env = cleanPat(process.env.INTIGRITI_PAT ?? '')
  if (env) return { pat: env, source: 'env' }
  return null
}

/** Guarda el PAT (limpio y con forma validada, cifrado). */
export function saveIntigritiToken(pat: string): void {
  const clean = cleanPat(pat)
  assertPatShape(clean)
  mkdirSync(settingsDir(), { recursive: true })
  writeFileSync(
    intigritiFile(),
    JSON.stringify({ patEnc: encryptWithKey(getOrCreateMasterKey(settingsDir()), clean) }, null, 2) + '\n',
    { mode: 0o600 },
  )
}

/** Revocación local: borra el fichero cifrado (el .env sigue como fallback). */
export function clearIntigritiToken(): void {
  rmSync(intigritiFile(), { force: true })
}

/** Estado para la UI — JAMÁS incluye el PAT, solo máscara (últimos 4). */
export interface IntigritiTokenStatus {
  source: IntigritiTokenSource | null
  /** Sin caducidad: un PAT es opaco, la validez se comprueba con «Probar conexión». */
  mask: string | null
}

export function describeIntigritiToken(): IntigritiTokenStatus {
  const t = loadIntigritiToken()
  if (!t) return { source: null, mask: null }
  return { source: t.source, mask: `••••${t.pat.slice(-4)}` }
}
