import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

// Redirigir cwd a un tmpdir ANTES de importar el módulo (settings usa cwd)
const tmp = mkdtempSync(path.join(tmpdir(), 'llm-settings-'))
process.chdir(tmp)

const { describeLlmSettings, loadLlmSettings, saveLlmSettings } = await import('./settings')

describe('llm settings (cifrado en reposo)', () => {
  beforeEach(() => {
    rmSync(path.join(tmp, '.settings'), { recursive: true, force: true })
  })

  it('sin settings → null; guardar y cargar round-trip', () => {
    expect(loadLlmSettings()).toBeNull()

    saveLlmSettings({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-secreta-1234',
    })

    expect(loadLlmSettings()).toEqual({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-secreta-1234',
    })
  })

  it('la clave NO aparece en claro en disco; describe() solo devuelve máscara', () => {
    saveLlmSettings({
      provider: 'zai',
      baseUrl: 'https://api.z.ai/api/paas/v4',
      model: 'glm-4.6',
      apiKey: 'sk-clave-super-secreta-9999',
    })

    const raw = readFileSync(path.join(tmp, '.settings', 'llm.json'), 'utf8')
    expect(raw).not.toContain('sk-clave-super-secreta-9999')
    expect(raw).toContain('v1.') // ciphertext presente
    expect(raw).toContain('"provider": "zai"') // no-secretos en claro

    expect(describeLlmSettings()).toEqual({
      provider: 'zai',
      baseUrl: 'https://api.z.ai/api/paas/v4',
      model: 'glm-4.6',
      hasKey: true,
      keyMask: '••••9999',
    })
  })

  it('apiKey vacía conserva la clave anterior; baseUrl inválida rechazada', () => {
    saveLlmSettings({
      provider: 'kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2-turbo-preview',
      apiKey: 'sk-original',
    })
    const changed = saveLlmSettings({
      provider: 'kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'moonshot-v1-128k',
      apiKey: '',
    })
    expect(changed.apiKey).toBe('sk-original')

    expect(() =>
      saveLlmSettings({ provider: 'custom', baseUrl: 'ftp://no', model: 'x', apiKey: 'k' }),
    ).toThrow(/base URL/)
  })

  it('fichero corrupto → null sin lanzar', () => {
    saveLlmSettings({
      provider: 'custom',
      baseUrl: 'https://x.example/v1',
      model: 'm',
      apiKey: 'k',
    })
    writeFileSync(path.join(tmp, '.settings', 'llm.json'), '{json roto')
    expect(loadLlmSettings()).toBeNull()
  })
})

afterAll(() => {
  process.chdir(tmpdir())
  rmSync(tmp, { recursive: true, force: true })
})
