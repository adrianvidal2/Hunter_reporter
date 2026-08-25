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
  /** Proveedores seleccionados (paso 2, multi). */
  providers: string[]
  /** Texto final del prompt (paso 2): biblioteca, editado o nuevo. */
  prompt: string
  /** Modo (paso 3): orca | terminal. */
  mode: LaunchMode
}

/** Agrega el objeto final del lanzamiento (solo memoria, nada a disco). */
export function buildLaunchDraft(input: {
  assets: string[]
  username: string
  password: string
  providers: Iterable<string>
  prompt: string
  mode: LaunchMode
}): LaunchDraft {
  return {
    assets: [...input.assets],
    username: input.username,
    password: input.password,
    providers: [...input.providers],
    prompt: input.prompt,
    mode: input.mode,
  }
}

/** Alterna un proveedor en un Set (multi-selección). Returns nuevo Set. */
export function toggleProvider(
  selected: ReadonlySet<string>,
  name: string,
): Set<string> {
  const next = new Set(selected)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  return next
}

/** Valida el formulario antes de confirmar. Exige al menos un proveedor y
 *  un prompt con contenido (no vacío tras trim). Devuelve mensaje o null. */
export function validateLaunch(
  selectedProviders: ReadonlySet<string>,
  prompt: string = '',
): string | null {
  if (selectedProviders.size === 0) return 'Selecciona al menos un proveedor.'
  if (prompt.trim() === '') return 'El prompt no puede estar vacío.'
  return null
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
