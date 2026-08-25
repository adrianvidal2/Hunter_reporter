import { describe, expect, it } from 'vitest'
import { estimateCostUsd, PRICING } from './pricing'

describe('estimateCostUsd (8.9: coste estimado)', () => {
  it('modelo tabulado: tokens/1M × precio in/out', () => {
    const c = estimateCostUsd('deepseek-chat', 1_000_000, 500_000)
    expect(c).not.toBeNull()
    // 1M × 0.28 + 0.5M × 0.42 = 0.49
    expect(c!.usd).toBeCloseTo(0.49, 5)
    expect(c!.basis).toContain('precios')
    expect(c!.basis).not.toContain('aprox')
  })

  it('modelo no tabulado con familia conocida → precios de referencia, basis aprox', () => {
    const c = estimateCostUsd('deepseek-v4-flash', 100_000, 50_000)
    expect(c).not.toBeNull()
    const ref = PRICING['deepseek-chat']!
    expect(c!.usd).toBeCloseTo((100_000 / 1e6) * ref.input + (50_000 / 1e6) * ref.output, 6)
    expect(c!.basis).toContain('familia aprox')
  })

  it('modelo desconocido sin familia → null (no se inventa coste)', () => {
    expect(estimateCostUsd('gpt-misterioso-x', 1000, 1000)).toBeNull()
  })

  it('sin tokens → null; redondeo a micro-dólares', () => {
    expect(estimateCostUsd('deepseek-chat', undefined, undefined)).toBeNull()
    const tiny = estimateCostUsd('deepseek-chat', 100, 100)
    expect(tiny!.usd).toBeLessThan(0.0001)
  })
})
