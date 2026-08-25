/**
 * Providers LLM OpenAI-compatible (paso 8.1).
 *
 * La app habla el dialecto `/chat/completions`; provider = baseUrl + lista
 * de modelos sugeridos. "custom" permite cualquier endpoint compatible.
 */

export type ProviderId = 'zai' | 'deepseek' | 'kimi' | 'custom'

export interface ProviderPreset {
  id: ProviderId
  label: string
  baseUrl: string
  /** Sugerencias para el datalist; el usuario puede escribir otra. */
  models: string[]
  docsUrl: string
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'zai',
    label: 'z.ai (GLM)',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air'],
    docsUrl: 'https://docs.z.ai/',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    docsUrl: 'https://api-docs.deepseek.com/',
  },
  {
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-turbo-preview', 'kimi-k2-0905-preview', 'moonshot-v1-128k'],
    docsUrl: 'https://platform.moonshot.cn/docs/',
  },
  {
    id: 'custom',
    label: 'Personalizado (OpenAI-compatible)',
    baseUrl: '',
    models: [],
    docsUrl: '',
  },
]

export function providerById(id: string): ProviderPreset | undefined {
  return PROVIDERS.find((p) => p.id === id)
}
