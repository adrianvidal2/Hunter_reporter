/**
 * Planificador de autoguardado con debounce (paso 4.9).
 *
 * Cada edición REPROGRAMA el mismo temporizador: N ediciones rápidas
 * producen 1 sola escritura, 1,5 s después de la última. Sin dependencias
 * de React para poder testearlo con temporizadores falsos.
 */

export interface AutosaveScheduler {
  /** Reprograma el guardado (llamar en cada cambio del documento). */
  schedule(): void
  /** Cancela un guardado pendiente. */
  cancel(): void
  /** ¿Hay un guardado pendiente de dispararse? */
  isPending(): boolean
}

export const AUTOSAVE_DELAY_MS = 1500

export function createAutosaveScheduler(
  save: () => void | Promise<void>,
  delayMs: number = AUTOSAVE_DELAY_MS,
): AutosaveScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null

  return {
    schedule() {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void save()
      }, delayMs)
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
    isPending: () => timer !== null,
  }
}
