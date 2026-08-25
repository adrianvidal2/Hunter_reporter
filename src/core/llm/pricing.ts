/**
 * Precios orientativos por millón de tokens (USD) para estimar el coste de
 * cada ejecución (8.9). NO son facturación: son una estimación editable.
 *
 * - `asOf`: fecha de consulta de las tarifas públicas.
 * - Fallback por familia: si el modelo exacto no está tabulado pero su
 *   nombre arranca por una familia conocida (p. ej. "deepseek-v4-flash"),
 *   se usan los precios de referencia de esa familia y el basis lo marca
 *   como aproximado.
 * - Modelo desconocido sin familia → null: NO se inventa coste.
 */

export interface ModelPrice {
  input: number
  output: number
}

/** Precios tabulados (USD / 1M tokens). Editar aquí cuando cambien. */
export const PRICING: Record<string, ModelPrice> = {
  // DeepSeek (tarifas públicas)
  'deepseek-chat': { input: 0.28, output: 0.42 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  // z.ai (GLM)
  'glm-4.6': { input: 0.6, output: 2.2 },
  'glm-4.5': { input: 0.6, output: 2.2 },
  'glm-4.5-air': { input: 0.2, output: 1.1 },
  // Moonshot (Kimi)
  'kimi-k2-turbo-preview': { input: 0.6, output: 2.5 },
  'kimi-k2-0905-preview': { input: 0.6, output: 2.5 },
}

/** Referencia por familia para modelos no tabulados. */
const FAMILY_FALLBACK: { prefix: string; refModel: string }[] = [
  { prefix: 'deepseek', refModel: 'deepseek-chat' },
  { prefix: 'glm-', refModel: 'glm-4.6' },
  { prefix: 'kimi-', refModel: 'kimi-k2-turbo-preview' },
]

export const PRICING_AS_OF = '2025-09'

export interface CostEstimate {
  usd: number
  /** Cómo se calculó (para mostrar junto al número). */
  basis: string
}

export function estimateCostUsd(
  model: string,
  promptTokens: number | undefined,
  completionTokens: number | undefined,
): CostEstimate | null {
  if (promptTokens === undefined && completionTokens === undefined) return null

  let price = PRICING[model]
  let approx = false
  if (!price) {
    const fam = FAMILY_FALLBACK.find((f) => model.toLowerCase().startsWith(f.prefix))
    if (!fam) return null
    price = PRICING[fam.refModel]!
    approx = true
  }

  const inT = promptTokens ?? 0
  const outT = completionTokens ?? 0
  const usd = (inT / 1e6) * price.input + (outT / 1e6) * price.output
  return {
    usd: Math.round(usd * 1e6) / 1e6, // 6 decimales: micro-dólares
    basis: `estimado (${approx ? 'familia aprox., ' : ''}precios ${PRICING_AS_OF}, USD/1M)`,
  }
}
