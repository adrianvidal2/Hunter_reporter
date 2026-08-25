import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { decryptWithKey, encryptWithKey, getOrCreateMasterKey } from '../../lib/secrets'
import { providerById, type ProviderId } from './providers'

/**
 * Ajustes LLM cifrados en reposo (8.1). Viven en `<app>/.settings/llm.json`
 * (fuera del árbol de reportes, gitignored). La API key se cifra con
 * AES-256-GCM; el resto de campos (provider/baseUrl/model) van en claro
 * porque no son secretos.
 *
 * La clave NUNCA sale del servidor: `describeLlmSettings` devuelve solo una
 * máscara (últimos 4 caracteres).
 */

export interface LlmSettings {
  provider: ProviderId
  baseUrl: string
  model: string
  apiKey: string
}

/** Versión SIN el secreto, apta para el cliente. */
export interface LlmSettingsPublic {
  provider: ProviderId
  baseUrl: string
  model: string
  hasKey: boolean
  keyMask?: string
}

export function settingsDir(): string {
  return path.join(process.cwd(), '.settings')
}

function llmFile(): string {
  return path.join(settingsDir(), 'llm.json')
}

interface StoredShape {
  provider: ProviderId
  baseUrl: string
  model: string
  /** v1.<iv>.<tag>.<data> */
  apiKeyEnc?: string
}

export function loadLlmSettings(): LlmSettings | null {
  const file = llmFile()
  if (!existsSync(file)) return null
  try {
    const stored = JSON.parse(readFileSync(file, 'utf8')) as StoredShape
    return {
      provider: stored.provider,
      baseUrl: stored.baseUrl,
      model: stored.model,
      apiKey: stored.apiKeyEnc
        ? decryptWithKey(getOrCreateMasterKey(settingsDir()), stored.apiKeyEnc)
        : '',
    }
  } catch (err) {
    console.error('loadLlmSettings: fichero corrupto, se ignora:', err)
    return null
  }
}

/**
 * Guarda los ajustes. `apiKey: ''` conserva la clave ya guardada (permite
 * cambiar modelo sin re-pegar el secreto).
 */
export function saveLlmSettings(input: {
  provider: string
  baseUrl: string
  model: string
  apiKey?: string
}): LlmSettings {
  const provider = (providerById(input.provider)?.id ?? 'custom') as ProviderId
  const baseUrl = input.baseUrl.trim()
  const model = input.model.trim()
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
    throw new Error('La base URL debe empezar por http:// o https://')
  }
  if (!model) throw new Error('Falta el modelo')

  const previous = loadLlmSettings()
  const apiKey = input.apiKey && input.apiKey.trim() !== '' ? input.apiKey.trim() : (previous?.apiKey ?? '')

  mkdirSync(settingsDir(), { recursive: true })
  const stored: StoredShape = {
    provider,
    baseUrl,
    model,
    apiKeyEnc: apiKey ? encryptWithKey(getOrCreateMasterKey(settingsDir()), apiKey) : undefined,
  }
  writeFileSync(llmFile(), JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 })
  return { provider, baseUrl, model, apiKey }
}

/** Vista pública (para la UI): sin la clave, solo su máscara. */
export function describeLlmSettings(): LlmSettingsPublic | null {
  const s = loadLlmSettings()
  if (!s) return null
  return {
    provider: s.provider,
    baseUrl: s.baseUrl,
    model: s.model,
    hasKey: s.apiKey !== '',
    keyMask: s.apiKey ? `••••${s.apiKey.slice(-4)}` : undefined,
  }
}
