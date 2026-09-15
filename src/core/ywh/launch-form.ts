import type { PromptMeta } from '@/core/prompts/prompts'

/**
 * Lógica PURA del PASO 2 del asistente Lanzar (multi-proveedores + prompt).
 * Separada del componente para poder testearla sin jsdom.
 *
 * - Proveedores: multi-selección sin límite; al menos uno para confirmar.
 * - Prompt: se elige de la biblioteca (.config/prompts) o se escribe uno
 *   al vuelo; la edición NO toca el original (el texto vive solo en el
 *   editor local).
 * - "Guardar como": crea un prompt NUEVO `<nombre>_<programa>` sin pisar
 *   el original.
 */

export const ENGINES = ['Pi', 'Hermes Agent', 'Claude Code', 'Kimi Code', 'Zcode', 'Deepseek']

/**
 * Mapeo proveedor del asistente → id de agente de Orca (flag --agent de
 * `worktree create`). UN SOLO SITIO: nada de ids dispersos por la app.
 *
 * Zcode y Deepseek están MARCAdOS como «por confirmar»: si Orca responde
 * «Unknown TUI agent» para ellos, el flujo lo marca como id no válido sin
 * romper el lote de proveedores.
 */
export const ORCA_AGENT_BY_PROVIDER: Record<string, string> = {
  Pi: 'pi',
  'Claude Code': 'claude',
  'Hermes Agent': 'hermes',
  'Kimi Code': 'kimi',
  Zcode: 'zcode', // id por confirmar
  Deepseek: 'deepseek', // id por confirmar
}

/** Id de agente de Orca para un proveedor ('' si no está mapeado). */
export function orcaAgentForProvider(provider: string): string {
  return ORCA_AGENT_BY_PROVIDER[provider] ?? ''
}

/* --- PASO 2 (reformado): lista de AGENTES con contadores y prompts ----- */

/** Un agente del lanzamiento (varios del mismo provider son agentes distintos). */
export interface LaunchAgent {
  /** id de agente Orca (pi, claude, hermes, kimi, …). */
  provider: string
  /** Prompt ENTERO de ESTE agente (el que realmente se lanzará). */
  prompt: string
  /** Nombre corto para distinguir: "Pi #1", "Pi #2", "Hermes #1". */
  label: string
}

/** Contadores por provider (nombre ENGINES → cantidad; 0/ausente = no seleccionado). */
export type ProviderCounts = Record<string, number>

export function emptyCounts(): ProviderCounts {
  return {}
}

/** Total de agentes = suma de contadores. */
export function totalAgents(counts: ProviderCounts): number {
  return Object.values(counts).reduce((a, b) => a + b, 0)
}

/** Marca un provider con contador 1; si ya está, lo DESMARCA (equivale a 0). */
export function toggleProviderCounts(counts: ProviderCounts, name: string): ProviderCounts {
  const next = { ...counts }
  if (next[name]) {
    delete next[name] // desmarcar = quitar (vía desmarcar, no vía contador)
  } else {
    next[name] = 1
  }
  return next
}

/** Sube el contador de un provider (+1). Marca con 1 si no estaba. */
export function bumpProvider(counts: ProviderCounts, name: string): ProviderCounts {
  return { ...counts, [name]: (counts[name] ?? 0) + 1 }
}

/** Baja el contador; MÍNIMO 1 (nunca 0 ni negativo por el contador). */
export function dimProvider(counts: ProviderCounts, name: string): ProviderCounts {
  const cur = counts[name] ?? 1
  return { ...counts, [name]: Math.max(1, cur - 1) }
}

/** Cuenta de un provider (0 si no seleccionado). */
export function providerCount(counts: ProviderCounts, name: string): number {
  return counts[name] ?? 0
}

/** Expande los contadores a la lista de agentes con labels auto:
 *  "Pi #1", "Pi #2", "Hermes #1"… (orden por ENGINES). */
export function agentsFromCounts(
  counts: ProviderCounts,
  /** prompt por label ("Pi #1" → prompt); el resto vacío. */
  promptByLabel: Record<string, string> = {},
): LaunchAgent[] {
  const out: LaunchAgent[] = []
  // orden estable por ENGINES (solo los seleccionados, por su aparición)
  const names = ENGINES.filter((n) => (counts[n] ?? 0) > 0)
  for (const name of names) {
    const id = orcaAgentForProvider(name)
    if (id === '') continue
    const n = counts[name] ?? 0
    for (let i = 1; i <= n; i++) {
      const label = `${shortProviderName(name)} #${i}`
      out.push({ provider: id, prompt: promptByLabel[label] ?? '', label })
    }
  }
  return out
}

/** Nombre corto del provider para el label ("Claude Code" → "Claude"). */
export function shortProviderName(provider: string): string {
  return provider.split(' ')[0] ?? provider
}

/** Contador de agentes con un label. */
export function totalAgentsFrom(list: LaunchAgent[]): number {
  return list.length
}

/** Valida la lista de agentes: ≥1 y TODOS con prompt no vacío. */
export function validateAgents(agents: LaunchAgent[]): string | null {
  if (agents.length === 0) return 'Selecciona al menos un agente.'
  const empty = agents.find((a) => a.prompt.trim() === '')
  if (empty) return `El prompt de «${empty.label}» no puede estar vacío.`
  return null
}

/* --- PASO 3: modo de lanzamiento (sumador, radio excluyente) --- */

export type LaunchMode = 'orca' | 'terminal'

export const LAUNCH_MODES: { value: LaunchMode; label: string }[] = [
  { value: 'orca', label: 'Lanzar Orca' },
  { value: 'terminal', label: 'Lanzar Terminal' },
]

/** Orca viene preseleccionada por defecto. */
export const DEFAULT_LAUNCH_MODE: LaunchMode = 'orca'

/** El objeto completo del lanzamiento (estado en memoria al confirmar). */
export interface LaunchDraft {
  /** Assets del scope marcados (paso 1). */
  assets: string[]
  /** Credenciales de test (paso 1). */
  username: string
  password: string
  /** Agentes (paso 2): lista con provider/prompt/label, prompt por agente. */
  agents: LaunchAgent[]
  /** Modo (paso 3): orca | terminal. */
  mode: LaunchMode
}

/** Agrega el objeto final del lanzamiento (solo memoria, nada a disco). */
export function buildLaunchDraft(input: {
  assets: string[]
  username: string
  password: string
  agents: Iterable<LaunchAgent>
  mode: LaunchMode
}): LaunchDraft {
  return {
    assets: [...input.assets],
    username: input.username,
    password: input.password,
    agents: [...input.agents],
    mode: input.mode,
  }
}

/** ¿El prompt tiene contenido? (falso si vacío o solo espacios/saltos). */
export function promptIsEmpty(prompt: string): boolean {
  return prompt.trim() === ''
}

/** Devuelve el contenido de un prompt de la biblioteca por slug, o '' si
 *  no se ha elegido ninguno (editor vacío para escribir al vuelo). */
export function promptContentFor(
  prompts: PromptMeta[],
  slug: string | null | undefined,
): string {
  if (!slug) return ''
  return prompts.find((p) => p.slug === slug)?.content ?? ''
}

/** Nombre para "Guardar como": `<nombre>_<programa>`. El saneado de slug y
 *  el control de colisión los hace createPrompt (igual que la ventana). */
export function savedAsName(baseName: string, program: string): string {
  const b = baseName.trim()
  const p = program.trim()
  if (b === '') return p === '' ? 'prompt' : p
  if (p === '') return b
  return `${b}_${p}`
}
