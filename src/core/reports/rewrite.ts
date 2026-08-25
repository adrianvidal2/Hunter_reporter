/**
 * Punto de extensión de reescritura con LLM (pasos 6.5 / bloque 8).
 *
 * ⚠️ Regla de oro (6.5): SIN APROBACIÓN NO SE EJECUTA NADA. Ninguna
 * detección del watcher puede disparar una reescritura: solo una decisión
 * humana explícita ('approved' en pending_actions) abre este flujo, y el
 * guard `assertApproved` se impone ANTES de tocar cualquier executor.
 */

/** El intento de reescritura no está aprobado por un humano. */
export class NotApprovedError extends Error {
  constructor(path: string, status: string | undefined) {
    super(
      `Sin aprobación no se ejecuta nada: "${path}" está en estado ` +
        `'${status ?? 'desconocido'}', no 'approved'`,
    )
    this.name = 'NotApprovedError'
  }
}

/** Lo que el bloque 8 recibirá para reescribir. */
export interface RewriteInput {
  path: string
  content: string
  /** hash de la detección: el bloque 8 lo usará para detectar derivas. */
  hash: string
}

/** Executor = llamada al LLM (bloque 8 lo implementa; hoy no existe). */
export type RewriteExecutor = (input: RewriteInput) => Promise<unknown>

/**
 * Guard explícito: sin estado 'approved' no se pasa de aquí.
 * `asserts` para que TypeScript también sepa que después sí lo es.
 */
export function assertApproved(
  path: string,
  status: string | undefined,
): asserts status is 'approved' {
  if (status !== 'approved') throw new NotApprovedError(path, status)
}
