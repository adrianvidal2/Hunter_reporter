'use client'

import { useState, useTransition } from 'react'
import {
  saveLlmSettingsAction,
  testLlmConnectionAction,
  type LlmSettingsInput,
} from '@/app/ajustes/actions'
import { PROVIDERS, providerById } from '@/core/llm/providers'
import type { LlmSettingsPublic } from '@/core/llm/settings'

/**
 * Formulario de Ajustes LLM (8.1). Elige provider (z.ai/DeepSeek/Kimi/custom),
 * base URL, modelo y API key. La clave solo viaja al guardar/probar; nunca
 * vuelve (se muestra su máscara si existe).
 */

const inputClass =
  'w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700'

export function LlmSettingsForm({ current }: { current: LlmSettingsPublic | null }) {
  const [provider, setProvider] = useState<string>(current?.provider ?? 'deepseek')
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? 'https://api.deepseek.com/v1')
  const [model, setModel] = useState(current?.model ?? 'deepseek-chat')
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [saving, startSaving] = useTransition()
  const [testing, startTesting] = useTransition()

  const preset = providerById(provider)

  const pickProvider = (id: string) => {
    setProvider(id)
    const p = providerById(id)
    if (p && p.baseUrl) {
      setBaseUrl(p.baseUrl)
      setModel(p.models[0] ?? '')
    }
    setStatus(null)
  }

  const input: LlmSettingsInput = { provider, baseUrl, model, apiKey }

  const save = () =>
    startSaving(async () => {
      const res = await saveLlmSettingsAction(input)
      setStatus(
        res.ok
          ? {
              ok: true,
              msg: `Guardado: ${res.saved?.model} · clave ${res.saved?.hasKey ? res.saved.keyMask : 'NO configurada'}`,
            }
          : { ok: false, msg: res.error ?? 'Error' },
      )
      if (res.ok) setApiKey('')
    })

  const test = () =>
    startTesting(async () => {
      setStatus({ ok: true, msg: 'Probando conexión…' })
      const res = await testLlmConnectionAction(input)
      setStatus(
        res.ok
          ? { ok: true, msg: `✅ Conexión OK (${res.latencyMs} ms) · respondió: «${res.replied}»` }
          : { ok: false, msg: `❌ ${res.error}` },
      )
    })

  return (
    <section aria-label="Ajustes del proveedor LLM" className="mt-6 max-w-2xl space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Provider
        </label>
        <select
          value={provider}
          onChange={(e) => pickProvider(e.target.value)}
          className={`${inputClass} dark:[color-scheme:dark]`}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {preset?.docsUrl ? (
          <p className="mt-1 text-xs text-zinc-400">
            Documentación:{' '}
            <a href={preset.docsUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {preset.docsUrl}
            </a>
          </p>
        ) : null}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Base URL (OpenAI-compatible, sin /chat/completions)
        </label>
        <input
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.ejemplo.com/v1"
          className={`${inputClass} font-mono`}
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Modelo
        </label>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          list="modelos-sugeridos"
          placeholder="nombre-del-modelo"
          className={`${inputClass} font-mono`}
        />
        <datalist id="modelos-sugeridos">
          {(preset?.models ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          API key {current?.hasKey ? `(guardada: ${current.keyMask} — déjala vacía para conservarla)` : ''}
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-…"
          autoComplete="off"
          className={`${inputClass} font-mono`}
        />
        <p className="mt-1 text-xs text-zinc-400">
          Se guarda cifrada (AES-256-GCM) en <code>.settings/llm.json</code>; nunca vuelve al
          navegador ni aparece en logs.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || testing}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {saving ? 'Guardando…' : 'Guardar ajustes'}
        </button>
        <button
          type="button"
          onClick={test}
          disabled={saving || testing}
          className="rounded-md border border-zinc-300 px-4 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {testing ? 'Probando…' : 'Probar conexión'}
        </button>
      </div>

      {status ? (
        <p
          role={status.ok ? 'status' : 'alert'}
          className={`text-sm ${status.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
        >
          {status.msg}
        </p>
      ) : null}
    </section>
  )
}
