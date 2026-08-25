'use server'

import { markManuallyApproved } from '@/db/pending'
import { generateRewriteFor, type GenerateResult } from '@/server/generate-rewrite'
import { getEnv } from '@/lib/env'

/**
 * 10.1: generar propuesta de reescritura para un BORRADOR (punto de entrada
 * desde la pestaña Borradores, con plantilla elegible).
 *
 * El clic del usuario ES la aprobación explícita: se materializa como fila
 * 'approved' en pending_actions (con el hash actual del disco) justo ANTES
 * de llamar al LLM — todas las validaciones ya habrán pasado. El guard 6.5
 * (assertApproved) queda intacto: el watcher solo crea 'pending'; solo una
 * acción humana crea 'approved'. Aceptar/Descartar (8.5/8.6) se reutilizan
 * tal cual desde la vista de revisión.
 */
export async function generateDraftRewriteAction(
  path: string,
  templateName?: string,
): Promise<GenerateResult> {
  return generateRewriteFor(path, templateName, {
    onBeforeLlm: (p) => markManuallyApproved(p, getEnv().REPORTS_ROOT),
  })
}
