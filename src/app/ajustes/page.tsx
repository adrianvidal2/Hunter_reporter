import { LlmSettingsForm } from '@/components/llm-settings-form'
import { LlmRunsLog } from '@/components/llm-runs-log'
import { YwhTokenSection } from '@/components/ywh-token-section'
import { describeLlmSettings } from '@/core/llm/settings'
import { describeYwhToken } from '@/core/ywh/token'

export const dynamic = 'force-dynamic'

/**
 * Ajustes (8.1): provider LLM OpenAI-compatible con clave cifrada en reposo.
 * La reescritura del bloque 8 usa esta configuración.
 */
export default function AjustesPage() {
  const current = describeLlmSettings()

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {current
          ? `Configurado: ${current.model} (${current.baseUrl})${current.hasKey ? ` · clave ${current.keyMask}` : ' · SIN clave'}`
          : 'Sin proveedor LLM configurado todavía.'}
      </p>
      <LlmSettingsForm current={current} />
      <YwhTokenSection current={describeYwhToken()} />
      <LlmRunsLog />
    </div>
  )
}
