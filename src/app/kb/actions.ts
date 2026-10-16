'use server'

import { revalidatePath } from 'next/cache'
import { listProjects } from '@/core/fs/tree'
import {
  createKb,
  deleteKb,
  type KbCategory,
  type KbEntry,
  type KbIndexEntry,
  type KbInput,
  listKbIndex,
  loadKbEntry,
  readKbReference,
  updateKb,
} from '@/core/kb/kb'
import { getEnv } from '@/lib/env'

/**
 * Server Actions de la página «Conocimiento» (KB, Tarea 6b). Cada una
 * valida en servidor y devuelve un resultado plano para la UI (forma
 * Res<T>, como app/prompts/actions.ts).
 *
 * El scope SIEMPRE lo valida el servidor: 'global' o un proyecto EXISTENTE
 * en REPORTS_ROOT — el cliente no decide rutas.
 */

type Res<T> = { ok: true; data: T } | { ok: false; error: string }

function assertScope(scope: string): void {
  if (scope === 'global') return
  if (!listProjects(getEnv().REPORTS_ROOT).includes(scope)) {
    throw new Error(`No existe el proyecto: ${scope}`)
  }
}

export async function listKbAction(project?: string): Promise<Res<KbIndexEntry[]>> {
  try {
    if (project !== undefined && project !== '') assertScope(project)
    return { ok: true, data: listKbIndex({ project: project || undefined }) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

export async function loadKbEntryAction(slug: string, project?: string): Promise<Res<KbEntry>> {
  try {
    return { ok: true, data: loadKbEntry(slug, { project: project || undefined }) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

export async function createKbAction(entry: KbInput, scope: string): Promise<Res<KbEntry>> {
  try {
    assertScope(scope)
    const created = createKb(entry, { scope })
    revalidatePath('/kb')
    return { ok: true, data: created }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

export async function updateKbAction(
  slug: string,
  patch: Partial<Pick<KbInput, 'name' | 'description' | 'category' | 'tags'>> & { body?: string },
  scope: string,
): Promise<Res<KbEntry>> {
  try {
    assertScope(scope)
    const updated = updateKb(slug, patch, { scope })
    revalidatePath('/kb')
    return { ok: true, data: updated }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

export async function deleteKbAction(slug: string, scope: string): Promise<Res<{ deleted: boolean }>> {
  try {
    assertScope(scope)
    const deleted = deleteKb(slug, { scope })
    revalidatePath('/kb')
    return { ok: true, data: { deleted } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

/** Contenido de UN reference (bajo demanda, para verlo desde la UI). */
export async function readKbReferenceAction(
  slug: string,
  refName: string,
  project?: string,
): Promise<Res<{ name: string; content: string }>> {
  try {
    const content = readKbReference(slug, refName, { project: project || undefined })
    return { ok: true, data: { name: refName, content } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

/** Tipos reexportados para el cliente (erased: los valores viven en core). */
export type { KbCategory, KbEntry, KbIndexEntry, KbInput }
