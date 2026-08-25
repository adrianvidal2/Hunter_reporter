/**
 * Cliente OpenAI-compatible mínimo (8.1; la reescritura de 8.2 lo reutiliza).
 *
 * - POST {baseUrl}/chat/completions, SIN streaming.
 * - AbortController con timeout.
 * - Errores tipados (LlmApiError.kind) para que cada caller muestre su
 *   mensaje propio (la batería completa de errores es 8.3).
 * - Función pura: cero lecturas/escrituras de disco.
 */

export type LlmErrorKind =
  | 'auth' // 401/403: clave inválida
  | 'rate_limit' // 429
  | 'server' // 5xx
  | 'timeout'
  | 'network'
  | 'bad_request' // 400/422
  | 'bad_json' // respuesta no parseable
  | 'empty' // 200 pero sin contenido utilizable

export class LlmApiError extends Error {
  constructor(
    public kind: LlmErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message)
    this.name = 'LlmApiError'
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionOptions {
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

export interface ChatCompletionResult {
  content: string
  finishReason: string
  model: string | undefined
  usage?: { promptTokens?: number; completionTokens?: number }
}

export async function chatCompletion(
  opts: ChatCompletionOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<ChatCompletionResult> {
  const { baseUrl, apiKey, model, messages } = opts
  if (!baseUrl) throw new LlmApiError('bad_request', 'Falta la base URL del provider')
  if (!apiKey) throw new LlmApiError('bad_request', 'Falta la API key')
  if (!model) throw new LlmApiError('bad_request', 'Falta el modelo')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000)

  let res: Response
  try {
    res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 32768,
        stream: false,
      }),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new LlmApiError('timeout', `Sin respuesta en ${opts.timeoutMs ?? 120_000} ms`)
    }
    throw new LlmApiError('network', `Error de red: ${(err as Error).message}`)
  }
  clearTimeout(timer)

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const detail = body.slice(0, 300).replace(/\s+/g, ' ').trim()
    const kind: LlmErrorKind =
      res.status === 401 || res.status === 403
        ? 'auth'
        : res.status === 429
          ? 'rate_limit'
          : res.status >= 500
            ? 'server'
            : 'bad_request'
    throw new LlmApiError(kind, `HTTP ${res.status}${detail ? `: ${detail}` : ''}`, res.status)
  }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new LlmApiError('bad_json', 'La respuesta no es JSON válido')
  }

  const choice = (json as { choices?: { message?: { content?: string }; finish_reason?: string }[] })
    .choices?.[0]
  const content = choice?.message?.content
  if (typeof content !== 'string' || content.trim() === '') {
    throw new LlmApiError('empty', 'Respuesta 200 pero sin contenido')
  }

  return {
    content,
    finishReason: choice?.finish_reason ?? 'unknown',
    model: (json as { model?: string }).model,
    usage: (json as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage && {
      promptTokens: (json as { usage: { prompt_tokens?: number } }).usage.prompt_tokens,
      completionTokens: (json as { usage: { completion_tokens?: number } }).usage.completion_tokens,
    },
  }
}
