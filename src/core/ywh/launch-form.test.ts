import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PromptMeta } from '@/core/prompts/prompts'
import { buildLaunchDraft, DEFAULT_LAUNCH_MODE, ENGINES, LAUNCH_MODES, promptContentFor, promptIsEmpty, savedAsName, toggleProvider, validateLaunch, type LaunchMode } from './launch-form'

const _t = tmpdir() as string
const _r = mkdtempSync(join(_t, 'launch-form-'))
rmSync(_r, { recursive: true, force: true })

const PROMPTS: PromptMeta[] = [
  { slug: 'recon', name: 'Recon', content: 'haz recon del scope' },
  { slug: 'exploit', name: 'Exploit', content: 'busca explotables' },
]

describe('toggleProvider (multi-selección de proveedores)', () => {
  it('alterna añadir y quitar, sin límite', () => {
    let s = new Set<string>()
    s = toggleProvider(s, 'Pi')
    s = toggleProvider(s, 'Claude Code')
    s = toggleProvider(s, 'Pi')
    expect([...s]).toEqual(['Claude Code'])
  })
  it('ENGINES tiene los 6 en orden', () => {
    expect(ENGINES).toEqual(['Pi', 'Hermes Agent', 'Claude Code', 'Kimi Code', 'Zcode', 'Deepseek'])
  })
})

describe('validateLaunch (confirmar)', () => {
  it('sin proveedor → error', () => {
    expect(validateLaunch(new Set())).toBe('Selecciona al menos un proveedor.')
  })
  it('con proveedor pero prompt vacío → error', () => {
    expect(validateLaunch(new Set(['Pi']), '')).toBe('El prompt no puede estar vacío.')
    expect(validateLaunch(new Set(['Pi']), '   \n  ')).toBe('El prompt no puede estar vacío.')
  })
  it('con proveedor y prompt con contenido → null (válido)', () => {
    expect(validateLaunch(new Set(['Pi']), 'actúa como pentester')).toBeNull()
    expect(validateLaunch(new Set(['Pi', 'Deepseek', 'Zcode']), 'prompt válido')).toBeNull()
  })
})

describe('promptIsEmpty', () => {
  it('vacío, solo espacios o solo saltos → true', () => {
    expect(promptIsEmpty('')).toBe(true)
    expect(promptIsEmpty('   ')).toBe(true)
    expect(promptIsEmpty('\n\n\t ')).toBe(true)
  })
  it('con contenido → false', () => {
    expect(promptIsEmpty('hola')).toBe(false)
    expect(promptIsEmpty('  hola  ')).toBe(false)
  })
})

describe('promptContentFor (carga del prompt en editor)', () => {
  it('devuelve el contenido del prompt elegido', () => {
    expect(promptContentFor(PROMPTS, 'recon')).toBe('haz recon del scope')
  })
  it('sin selección → editor vacío (escribir al vuelo)', () => {
    expect(promptContentFor(PROMPTS, null)).toBe('')
    expect(promptContentFor(PROMPTS, undefined)).toBe('')
  })
  it(`slug desconocido → cadena vacía (no rompe)`, () => {
    expect(promptContentFor(PROMPTS, 'no-existe')).toBe('')
  })
})

describe('savedAsName (Guardar como → <nombre>_<programa>)', () => {
  it('compone nombre_<programa>', () => {
    expect(savedAsName('Recon', 'demo_project')).toBe('Recon_demo_project')
  })
  it('edge cases: vacíos', () => {
    expect(savedAsName('', 'demo_project')).toBe('demo_project')
    expect(savedAsName('Recon', '')).toBe('Recon')
    expect(savedAsName('', '')).toBe('prompt')
  })
})

describe('PASO 3 — modo de lanzamiento y LaunchDraft', () => {
  it('Orca marcada por defecto y opciones excluyentes (orca | terminal)', () => {
    expect(DEFAULT_LAUNCH_MODE).toBe('orca')
    const values = LAUNCH_MODES.map((m) => m.value)
    expect(values).toContain('orca')
    expect(values).toContain('terminal')
    // solo dos opciones, excluyentes
    expect(values).toHaveLength(2)
    expect(new Set(values).size).toBe(2)
  })

  it('buildLaunchDraft agrupa el objeto completo con el modo correcto', () => {
    const draft = buildLaunchDraft({
      assets: ['https://a.test'],
      username: 'u',
      password: 'p',
      providers: ['Pi', 'Deepseek'],
      prompt: 'prompt final',
      mode: 'terminal' as LaunchMode,
    })
    expect(draft).toEqual({
      assets: ['https://a.test'],
      username: 'u',
      password: 'p',
      providers: ['Pi', 'Deepseek'],
      prompt: 'prompt final',
      mode: 'terminal',
    })
  })

  it('el modo por defecto es orca al construir el draft', () => {
    const draft = buildLaunchDraft({
      assets: [], username: '', password: '', providers: ['Pi'], prompt: '', mode: DEFAULT_LAUNCH_MODE,
    })
    expect(draft.mode).toBe('orca')
  })
})
