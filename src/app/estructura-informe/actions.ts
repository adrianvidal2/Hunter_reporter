'use server'

import { revalidatePath } from 'next/cache'
import {
  InvalidTemplateNameError,
  deleteTemplate as deleteTemplateCore,
  saveTemplate as saveTemplateCore,
} from '@/core/reports/templates'
import { PathEscapeError } from '@/core/fs/paths'
import { getEnv } from '@/lib/env'

/**
 * Server Actions del gestor de plantillas (paso 7.1). La validación y el
 * sistema de ficheros viven en el núcleo (core/reports/templates).
 */

export interface TemplateActionResult {
  ok: boolean
  error?: string
  /** Nombre normalizado (con .md) tras guardar. */
  savedAs?: string
}

export async function saveTemplateAction(
  name: string,
  content: string,
): Promise<TemplateActionResult> {
  try {
    const savedAs = saveTemplateCore(name, content, getEnv().REPORTS_ROOT)
    revalidatePath('/estructura-informe')
    return { ok: true, savedAs }
  } catch (err) {
    if (err instanceof InvalidTemplateNameError || err instanceof PathEscapeError) {
      return { ok: false, error: err.message }
    }
    console.error('saveTemplateAction:', err)
    return { ok: false, error: 'No se pudo guardar la plantilla (error inesperado)' }
  }
}

export async function deleteTemplateAction(name: string): Promise<TemplateActionResult> {
  try {
    if (!deleteTemplateCore(name, getEnv().REPORTS_ROOT)) {
      return { ok: false, error: 'Esa plantilla ya no existe' }
    }
    revalidatePath('/estructura-informe')
    return { ok: true }
  } catch (err) {
    if (err instanceof InvalidTemplateNameError || err instanceof PathEscapeError) {
      return { ok: false, error: err.message }
    }
    console.error('deleteTemplateAction:', err)
    return { ok: false, error: 'No se pudo borrar la plantilla (error inesperado)' }
  }
}
