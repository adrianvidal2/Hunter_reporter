'use server'

import { chatCompletion, LlmApiError } from '@/core/llm/client'
import { loadLlmSettings, saveLlmSettings } from '@/core/llm/settings'
import {
  assertTokenValid,
  clearYwhToken,
  describeYwhToken,
  saveYwhToken,
} from '@/core/ywh/token'
import {
  cleanPat,
  clearIntigritiToken,
  describeIntigritiToken,
  loadIntigritiToken,
  saveIntigritiToken,
} from '@/core/intigriti/token'
import { IntigritiApiError, IntigritiClient } from '@/core/intigriti/client'

/**
 * Server Actions de Ajustes LLM (paso 8.1).
 *
 * La API key viaja cliente→servidor SOLO al guardar/probar, vive cifrada en
 * disco y jamás se devuelve al cliente (describe → máscara).
 */

export interface LlmSettingsInput {
  provider: string
  baseUrl: string
  model: string
  /** '' → conservar la ya guardada */
  apiKey?: string
}

export interface SaveResult {
  ok: boolean
  error?: string
  saved?: { provider: string; baseUrl: string; model: string; hasKey: boolean; keyMask?: string }
}

export async function saveLlmSettingsAction(input: LlmSettingsInput): Promise<SaveResult> {
  try {
    saveLlmSettings(input)
    const { describeLlmSettings } = await import('@/core/llm/settings')
    return { ok: true, saved: describeLlmSettings() ?? undefined }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

export interface TestResult {
  ok: boolean
  error?: string
  /** Diagnóstico humano del fallo, por kind. */
  latencyMs?: number
  replied?: string
}

const KIND_MESSAGES: Record<string, string> = {
  auth: 'API key inválida o sin permisos (revisa la clave del provider)',
  rate_limit: 'El provider está aplicando rate limit (429); prueba en unos segundos',
  timeout: 'El provider no respondió a tiempo',
  network: 'No se pudo conectar (¿URL correcta? ¿red?)',
  bad_json: 'El provider devolvió una respuesta no válida',
  empty: 'El provider respondió 200 pero sin contenido',
  bad_request: 'Petición rechazada (¿modelo/base URL correctos?)',
  server: 'Error interno del provider (5xx)',
}

/** "Probar conexión": un chat completion mínimo con lo del formulario. */
export async function testLlmConnectionAction(input: LlmSettingsInput): Promise<TestResult> {
  const apiKey =
    input.apiKey && input.apiKey.trim() !== ''
      ? input.apiKey.trim()
      : (loadLlmSettings()?.apiKey ?? '')

  const start = Date.now()
  try {
    const res = await chatCompletion({
      baseUrl: input.baseUrl,
      apiKey,
      model: input.model,
      messages: [{ role: 'user', content: 'Responde solo con la palabra: pong' }],
      maxTokens: 5,
      temperature: 0,
      timeoutMs: 20_000,
    })
    return { ok: true, latencyMs: Date.now() - start, replied: res.content.slice(0, 40) }
  } catch (err) {
    if (err instanceof LlmApiError) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: `${KIND_MESSAGES[err.kind] ?? err.kind}: ${err.message}`,
      }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

// ── YesWeHack (9.3): JWT de sesión ───────────────────────────────────

export interface YwhTokenActionResult {
  ok: boolean
  error?: string
  status?: ReturnType<typeof describeYwhToken>
}

export async function saveYwhTokenAction(jwt: string): Promise<YwhTokenActionResult> {
  try {
    // valida formato Y expiración antes de guardar: no guardar un token muerto
    assertTokenValid(jwt.trim())
    saveYwhToken(jwt)
    return { ok: true, status: describeYwhToken() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

export async function clearYwhTokenAction(): Promise<YwhTokenActionResult> {
  clearYwhToken()
  return { ok: true, status: describeYwhToken() }
}

// ── Intigriti (paso 3): PAT opaco sin exp → «Probar conexión» ─────────

export interface IntigritiTokenActionResult {
  ok: boolean
  error?: string
  status?: ReturnType<typeof describeIntigritiToken>
}

export async function saveIntigritiTokenAction(pat: string): Promise<IntigritiTokenActionResult> {
  try {
    saveIntigritiToken(pat) // limpia espacios/saltos y valida la forma
    return { ok: true, status: describeIntigritiToken() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

export async function clearIntigritiTokenAction(): Promise<IntigritiTokenActionResult> {
  clearIntigritiToken()
  return { ok: true, status: describeIntigritiToken() }
}

export interface IntigritiTestResult {
  ok: boolean
  error?: string
  latencyMs?: number
  /** Nº de programas visibles (diagnóstico, sin contenido sensible). */
  programCount?: number
}

const INTIGRITI_KIND_MESSAGES: Record<string, string> = {
  auth: 'PAT inválido o sin permisos (revisa el token en perfil → API → researcher)',
  rate_limit: 'Intigriti está aplicando rate limit (429); prueba en unos segundos',
  timeout: 'Intigriti no respondió a tiempo',
  network: 'No se pudo conectar (¿red?)',
  bad_json: 'Intigriti devolvió una respuesta no válida',
  validation: 'La respuesta de Intigriti no tiene la forma esperada',
  server: 'Error interno de Intigriti (5xx)',
  not_found: 'Endpoint no encontrado (¿spec cambiado?)',
}

/**
 * «Probar conexión» del PAT (equivalente al de los providers del 8.1,
 * porque un PAT opaco no permite comprobar caducidad en local): una
 * llamada mínima `GET /v1/programs?limit=1&offset=0`.
 * Usa el PAT del formulario si se pega uno; si no, el ya guardado.
 * Jamás devuelve el token: solo ok/latencia/conteo.
 */
export async function testIntigritiConnectionAction(formPat?: string): Promise<IntigritiTestResult> {
  const form = formPat ? cleanPat(formPat) : ''
  const pat = form !== '' ? form : (loadIntigritiToken()?.pat ?? '')
  if (pat === '') {
    return { ok: false, error: 'No hay PAT: pega uno o guárdalo primero' }
  }

  const start = Date.now()
  try {
    const page = await new IntigritiClient(pat, { limit: 1, timeoutMs: 20_000 }).listProgramsPage(0)
    return { ok: true, latencyMs: Date.now() - start, programCount: page.records.length }
  } catch (err) {
    if (err instanceof IntigritiApiError) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: `${INTIGRITI_KIND_MESSAGES[err.kind] ?? err.kind}: ${err.message}`,
      }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}
