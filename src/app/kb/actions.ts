'use server'

import { revalidatePath } from 'next/cache'
import { listProjects } from '@/core/fs/tree'
import {
  createKb,
  deleteKb,
  KbCollisionError,
  type KbCategory,
  type KbEntry,
  type KbIndexEntry,
  type KbInput,
  listKbIndex,
  loadKbEntry,
  readKbReference,
  updateKb,
} from '@/core/kb/kb'
import { rebuildKbIndex, searchKb } from '@/db/kb-index'
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

// ── Feedback loop (08c): promover a KB SOLO con acción humana ──────────

export interface PromotePayload {
  /** Nombre legible: de aquí sale el slug (slugify de 6a). */
  title: string
  /** Cuerpo markdown de la entrada. */
  body: string
  /** Categoría (por defecto 'tecnica': primitivas/procedimientos). */
  category?: KbCategory
  tags?: string[]
  /** Origen del feedback (trazabilidad): finding | primitiva | hipotesis | manual. */
  source?: string
  /** Referencia del origen (p. ej. "finding:sql-injection@app.ejemplo.com"). */
  sourceRef?: string
}

/**
 * Promueve un finding/primitiva/hipótesis CONFIRMADO a la KB (Tarea 8c).
 * SIEMPRE acción humana explícita: no existe camino automático (lo que
 * dice el agente no se promueve solo). Colisión de slug → sufijo -2/-3
 * (promover lo mismo dos veces no es error, es una repetición). Tras
 * crear, reindexa el FTS para que sea buscable al instante.
 */
export async function promoteToKbAction(
  project: string,
  payload: PromotePayload,
  scope: string,
): Promise<Res<{ slug: string }>> {
  try {
    assertScope(scope)
    if (payload.title.trim() === '' || payload.body.trim() === '') {
      return { ok: false, error: 'Faltan título o cuerpo: no se promueve una entrada vacía' }
    }

    const origin = payload.source ?? 'manual'
    const tags = [...new Set([...(payload.tags ?? []), 'promovido', `origen:${origin}`])]
    const body = [
      `> ⬆️ Promovido a KB manualmente (08c). Origen: ${origin}${payload.sourceRef ? ` — ${payload.sourceRef}` : ''}. Fecha: ${new Date().toISOString().slice(0, 10)}.`,
      '',
      payload.body,
    ].join('\n')

    const entry: KbInput = {
      name: payload.title,
      description: payload.sourceRef ?? payload.title,
      category: payload.category ?? 'tecnica',
      tags,
      body,
    }

    // colisión → sufijo automático (título "foo" → "foo 2" → slug foo-2)
    let created: KbEntry | null = null
    let lastError: unknown
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const name = attempt === 0 ? entry.name : `${entry.name} ${attempt + 1}`
      try {
        created = createKb({ ...entry, name }, { scope })
      } catch (err) {
        if (err instanceof KbCollisionError) {
          lastError = err
          continue
        }
        throw err
      }
    }
    if (!created) {
      return { ok: false, error: lastError instanceof Error ? lastError.message : 'No se encontró un slug libre' }
    }

    // reindexar FTS: buscable al instante (índice reconstruible, coste ~0)
    try {
      rebuildKbIndex(getEnv().REPORTS_ROOT)
    } catch {
      /* sin reindexado seguirá apareciendo en el próximo rebuild */
    }

    revalidatePath('/kb')
    revalidatePath(`/proyectos/${encodeURIComponent(project)}`)
    return { ok: true, data: { slug: created.slug } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

/** Búsqueda FTS de la KB (para consumidores de UI: probador rápido de recuperación). */
export async function searchKbAction(
  query: string,
  opts: { project?: string; category?: KbCategory; limit?: number } = {},
): Promise<Res<{ slug: string; title: string; category: string; scope: string; description: string; rank: number }[]>> {
  try {
    if (opts.project !== undefined && opts.project !== '') assertScope(opts.project)
    const hits = searchKb(query, {
      project: opts.project || undefined,
      category: opts.category,
      limit: opts.limit,
    })
    return {
      ok: true,
      data: hits.map((h) => ({
        slug: h.slug,
        title: h.title,
        category: h.category,
        scope: h.scope,
        description: h.description,
        rank: h.rank,
      })),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}
