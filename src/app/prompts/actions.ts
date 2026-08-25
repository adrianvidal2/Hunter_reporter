'use server'

import { revalidatePath } from 'next/cache'
import {
  createPrompt,
  deletePrompt,
  type PromptMeta,
  PromptCollisionError,
  PromptNotFoundError,
  updatePrompt,
} from '@/core/prompts/prompts'

/**
 * Server Actions (Prompts, CRUD global). Cada una valida en servidor y
 * devuelve un resultado plano para la UI.
 */

type Res<T> = { ok: true; data: T } | { ok: false; error: string }

export async function createPromptAction(name: string, content: string): Promise<Res<PromptMeta>> {
  try {
    const p = createPrompt(name, content)
    revalidatePath('/prompts')
    return { ok: true, data: p }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

export async function updatePromptAction(
  slug: string,
  patch: { name?: string; content?: string },
): Promise<Res<PromptMeta>> {
  try {
    const p = updatePrompt(slug, patch)
    revalidatePath('/prompts')
    return { ok: true, data: p }
  } catch (err) {
    if (err instanceof PromptCollisionError || err instanceof PromptNotFoundError) {
      return { ok: false, error: err.message }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}

export async function deletePromptAction(slug: string): Promise<Res<{ deleted: boolean }>> {
  try {
    const deleted = deletePrompt(slug)
    revalidatePath('/prompts')
    return { ok: true, data: { deleted } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error inesperado' }
  }
}
