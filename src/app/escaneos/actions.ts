'use server'

import { revalidatePath } from 'next/cache'
import { buildScansView, type ScanRow } from '@/server/scans'
import { loadOrcaSettings } from '@/core/orca/settings'
import { combined, defaultExec } from '@/core/orca/runner'
import { errorText, extractJsonBlock } from '@/core/orca/orca'

/** Escaneos: el estado en vivo se pide AL ABRIR (server page) y con
 *  "Actualizar" (esta action). Nunca se cachea. */
export type ScansActionResult =
  | { ok: true; rows: ScanRow[] }
  | { ok: false; error: string }

export async function refreshScansAction(project?: string): Promise<ScansActionResult> {
  try {
    const view = await buildScansView(undefined, { project })
    revalidatePath(project ? `/proyectos/${encodeURIComponent(project)}` : '/escaneos')
    return { ok: true, rows: view.rows }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

/** Abre la sesión en la app de Orca (--focus). Devuelve el mensaje real. */
export async function focusTerminalAction(handle: string): Promise<
  | { ok: true; note?: string }
  | { ok: false; error: string }
> {
  try {
    const { orcaBin } = loadOrcaSettings()
    const r = await defaultExec(orcaBin, ['terminal', 'focus', '--handle', handle, '--json'])
    const block = extractJsonBlock(combined(r))
    if (block && typeof block === 'object' && (block as Record<string, unknown>).ok === false) {
      const msg = errorText((block as Record<string, unknown>).result ?? (block as Record<string, unknown>).message)
      return { ok: false, error: msg || 'Orca no pudo enfocar la sesión' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

/** Lee las últimas líneas del terminal (preview). */
export type ReadTerminalResult =
  | { ok: true; output: string }
  | { ok: false; error: string }

export async function readTerminalAction(handle: string): Promise<ReadTerminalResult> {
  try {
    const { orcaBin } = loadOrcaSettings()
    const r = await defaultExec(orcaBin, ['terminal', 'read', '--handle', handle, '--json'])
    const block = extractJsonBlock(combined(r))
    if (block && typeof block === 'object') {
      const b = block as Record<string, unknown>
      if (b.ok === false) {
        return { ok: false, error: errorText(b.result ?? b.message ?? b.error) || 'No se pudo leer la salida' }
      }
      // resultado: output / result.output / block.output
      const result = (b.result ?? b) as Record<string, unknown>
      const output = typeof result.output === 'string' ? result.output : typeof b.output === 'string' ? b.output : ''
      return { ok: true, output }
    }
    // si no hay JSON, devolver el stdout crudo (últimas líneas)
    const raw = r.stdout.trim()
    return raw !== ''
      ? { ok: true as const, output: raw.slice(-4000) }
      : { ok: false as const, error: 'No se pudo leer la salida' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}
