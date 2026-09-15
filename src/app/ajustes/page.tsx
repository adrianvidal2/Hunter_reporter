import { LlmSettingsForm } from '@/components/llm-settings-form'
import { LlmRunsLog } from '@/components/llm-runs-log'
import { YwhTokenSection } from '@/components/ywh-token-section'
import { IntigritiTokenSection } from '@/components/intigriti-token-section'
import { ReconSettingsSection } from '@/components/recon-settings-section'
import { getReconBinStatusAction } from '../escaneos/recon-actions'
import { describeLlmSettings } from '@/core/llm/settings'
import { describeYwhToken } from '@/core/ywh/token'
import { describeIntigritiToken } from '@/core/intigriti/token'

export const dynamic = 'force-dynamic'

/**
 * Ajustes (8.1): provider LLM OpenAI-compatible con clave cifrada en reposo.
 * La reescritura del bloque 8 usa esta configuración.
 */
export default async function AjustesPage() {
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
      <IntigritiTokenSection current={describeIntigritiToken()} />
      <ReconSettingsSection initial={await getReconBinStatusAction()} />
      <LlmRunsLog />
    </div>
  )
}
