import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PromptMeta } from '@/core/prompts/prompts'
import {
  agentsFromCounts,
  buildLaunchDraft,
  bumpProvider,
  DEFAULT_LAUNCH_MODE,
  dimProvider,
  emptyCounts,
  ENGINES,
  LAUNCH_MODES,
  ORCA_AGENT_BY_PROVIDER,
  orcaAgentForProvider,
  promptContentFor,
  promptIsEmpty,
  providerCount,
  savedAsName,
  shortProviderName,
  toggleProviderCounts,
  totalAgents,
  validateAgents,
  type LaunchMode,
} from './launch-form'

const _t = tmpdir() as string
const _r = mkdtempSync(join(_t, 'launch-form-'))
rmSync(_r, { recursive: true, force: true })

const PROMPTS: PromptMeta[] = [
  { slug: 'recon', name: 'Recon', content: 'haz recon del scope' },
  { slug: 'exploit', name: 'Exploit', content: 'busca explotables' },
]

describe('contadores de agentes (paso 2 reformado)', () => {
  it('ENGINES tiene los 6 en orden', () => {
    expect(ENGINES).toEqual(['Pi', 'Hermes Agent', 'Claude Code', 'Kimi Code', 'Zcode', 'Deepseek'])
  })

  it('marcar arranca en 1; desmarcar QUITA el provider (equivale a 0)', () => {
    let c = toggleProviderCounts(emptyCounts(), 'Pi')
    expect(providerCount(c, 'Pi')).toBe(1)
    c = toggleProviderCounts(c, 'Pi')
    expect(providerCount(c, 'Pi')).toBe(0) // quitado vía desmarcar
  })

  it('contador mínimo 1: dim no baja de 1 ni a cero/negativo', () => {
    let c: Record<string, number> = { Pi: 1 }
    c = dimProvider(c, 'Pi')
    expect(providerCount(c, 'Pi')).toBe(1)
    c = bumpProvider(c, 'Pi')
    c = dimProvider(c, 'Pi')
    expect(providerCount(c, 'Pi')).toBe(1)
  })

  it('total de agentes = suma de contadores', () => {
    const c: Record<string, number> = { Pi: 2, 'Hermes Agent': 1 }
    expect(totalAgents(c)).toBe(3)
  })
})

describe('expandir contadores → agentes con labels', () => {
  it('Pi=2 + Hermes=1 → 3 agentes con labels Pi #1/Pi #2/Hermes #1', () => {
    const c = { Pi: 2, 'Hermes Agent': 1 }
    const agents = agentsFromCounts(c)
    expect(agents).toHaveLength(3)
    expect(agents.map((a) => a.label)).toEqual(['Pi #1', 'Pi #2', 'Hermes #1'])
    expect(agents.map((a) => a.provider)).toEqual(['pi', 'pi', 'hermes'])
  })

  it('varios del mismo provider son agentes distintos', () => {
    const agents = agentsFromCounts({ Pi: 2 })
    expect(agents[0]!.label).toBe('Pi #1')
    expect(agents[1]!.label).toBe('Pi #2')
    expect(agents[0]!.provider).toBe(agents[1]!.provider)
  })

  it('labels auto por shortProviderName', () => {
    expect(shortProviderName('Claude Code')).toBe('Claude')
    expect(agentsFromCounts({ 'Claude Code': 1 })[0]!.label).toBe('Claude #1')
  })
})

describe('validateAgents (cada agente con prompt no vacío)', () => {
  it('sin agentes → error', () => {
    expect(validateAgents([])).toBe('Selecciona al menos un agente.')
  })
  it('un agente con prompt vacío → error con su label', () => {
    expect(validateAgents([{ provider: 'pi', prompt: '   ', label: 'Pi #1' }])).toBe('El prompt de «Pi #1» no puede estar vacío.')
  })
  it('todos con contenido → null', () => {
    expect(validateAgents([
      { provider: 'pi', prompt: 'a', label: 'Pi #1' },
      { provider: 'claude', prompt: 'b', label: 'Claude #1' },
    ])).toBeNull()
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
      agents: [
        { provider: 'pi', prompt: 'p1', label: 'Pi #1' },
        { provider: 'deepseek', prompt: 'p2', label: 'Deepseek #1' },
      ],
      mode: 'terminal' as LaunchMode,
    })
    expect(draft).toEqual({
      assets: ['https://a.test'],
      username: 'u',
      password: 'p',
      agents: [
        { provider: 'pi', prompt: 'p1', label: 'Pi #1' },
        { provider: 'deepseek', prompt: 'p2', label: 'Deepseek #1' },
      ],
      mode: 'terminal',
    })
  })

  it('el modo por defecto es orca al construir el draft', () => {
    const draft = buildLaunchDraft({
      assets: [], username: '', password: '',
      agents: [{ provider: 'pi', prompt: '', label: 'Pi #1' }],
      mode: DEFAULT_LAUNCH_MODE,
    })
    expect(draft.mode).toBe('orca')
  })
})

describe('ORCA_AGENT_BY_PROVIDER (mapeo proveedor → id de agente Orca)', () => {
  it('todos los proveedores del asistente están mapeados en UN solo sitio', () => {
    expect(ORCA_AGENT_BY_PROVIDER).toEqual({
      Pi: 'pi',
      'Claude Code': 'claude',
      'Hermes Agent': 'hermes',
      'Kimi Code': 'kimi',
      Zcode: 'zcode',
      Deepseek: 'deepseek',
    })
  })

  it('orcaAgentForProvider devuelve el id o cadena vacía si no está mapeado', () => {
    expect(orcaAgentForProvider('Pi')).toBe('pi')
    expect(orcaAgentForProvider('Claude Code')).toBe('claude')
    expect(orcaAgentForProvider('Hermes Agent')).toBe('hermes')
    expect(orcaAgentForProvider('Kimi Code')).toBe('kimi')
    expect(orcaAgentForProvider('Zcode')).toBe('zcode') // id por confirmar
    expect(orcaAgentForProvider('Deepseek')).toBe('deepseek') // id por confirmar
    expect(orcaAgentForProvider('Proveedor inválido')).toBe('')
  })
})
