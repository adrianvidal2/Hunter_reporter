import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertPatShape,
  cleanPat,
  clearIntigritiToken,
  describeIntigritiToken,
  loadIntigritiToken,
  saveIntigritiToken,
} from './token'

// Redirigir cwd a un tmpdir ANTES de importar el módulo (usa cwd/.settings)
const tmp = mkdtempSync(path.join(tmpdir(), 'intigriti-token-'))
process.chdir(tmp)

const PAT = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefghij ABCDEF' // 66 chars con un espacio trampa

beforeEach(() => {
  clearIntigritiToken()
  delete process.env.INTIGRITI_PAT
})

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('paso 3 · PAT de Intigriti (opaco, sin exp)', () => {
  it('cleanPat quita espacios y saltos en extremos Y dentro', () => {
    expect(cleanPat('  abc def  ')).toBe('abcdef')
    expect(cleanPat('abc\ndef\nghi')).toBe('abcdefghi')
    expect(cleanPat('a\tb')).toBe('ab')
  })

  it('guardar limpia, cifra y cargar devuelve el PAT original (round-trip cifrado)', () => {
    saveIntigritiToken(`  ${PAT}\n`)
    const t = loadIntigritiToken()
    expect(t?.source).toBe('ui')
    expect(t?.pat).toBe(PAT.replace(/\s+/g, ''))

    // en disco está cifrado: el PAT en claro NO aparece
    const raw = readFileSync(path.join(tmp, '.settings', 'intigriti.json'), 'utf8')
    expect(raw).not.toContain(PAT)
    expect(raw).toContain('patEnc')

    clearIntigritiToken()
    expect(existsSync(path.join(tmp, '.settings', 'intigriti.json'))).toBe(false)
  })

  it('rechaza PATs sin forma válida (demasiado corto, con espacios si llegase sin limpiar)', () => {
    expect(() => saveIntigritiToken('corto')).toThrow(/demasiado corto/)
    expect(() => assertPatShape('x'.repeat(30) + ' y '.repeat(3))).toThrow(/espacios/)
    // save limpia antes de validar: un PAT con espacios/saltos pegado se guarda limpio
    expect(() => saveIntigritiToken('x'.repeat(30) + ' y '.repeat(3))).not.toThrow()
  })

  it('precedencia ui > env; fallback INTIGRITI_PAT (también limpio); sin nada → null', () => {
    process.env.INTIGRITI_PAT = `  ${PAT}\n  `
    expect(loadIntigritiToken()).toMatchObject({ source: 'env', pat: PAT.replace(/\s+/g, '') })

    saveIntigritiToken(PAT)
    expect(loadIntigritiToken()?.source).toBe('ui')

    clearIntigritiToken()
    delete process.env.INTIGRITI_PAT
    expect(loadIntigritiToken()).toBeNull()
  })

  it('describe: SOLO máscara con los últimos 4 caracteres, sin caducidad', () => {
    expect(describeIntigritiToken()).toEqual({ source: null, mask: null })

    process.env.INTIGRITI_PAT = PAT
    const st = describeIntigritiToken()
    expect(st.source).toBe('env')
    expect(st.mask).toBe(`••••${PAT.slice(-4)}`)
    expect(JSON.stringify(st)).not.toContain(PAT)
    expect(st).not.toHaveProperty('expiresAt')
    expect(st).not.toHaveProperty('expired')
  })
})
