import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptWithKey, encryptWithKey } from './secrets'

describe('secrets (AES-256-GCM)', () => {
  const key = randomBytes(32)

  it('round-trip encrypt→decrypt devuelve el original', () => {
    const secret = 'sk-abc-123-áé-!!!-con espacios'
    expect(decryptWithKey(key, encryptWithKey(key, secret))).toBe(secret)
  })

  it('IV aleatorio: dos cifrados del mismo texto NO coinciden', () => {
    const a = encryptWithKey(key, 'mismo secreto')
    const b = encryptWithKey(key, 'mismo secreto')
    expect(a).not.toBe(b)
    expect(decryptWithKey(key, a)).toBe('mismo secreto')
    expect(decryptWithKey(key, b)).toBe('mismo secreto')
  })

  it('payload alterado → error (auth tag)', () => {
    const payload = encryptWithKey(key, 'secreto')
    const tampered = `${payload.slice(0, -4)}beef`
    expect(() => decryptWithKey(key, tampered)).toThrow()
    expect(() => decryptWithKey(key, 'basura-total')).toThrow(/formato desconocido/)
  })
})
