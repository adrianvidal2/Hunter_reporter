/**
 * Pestañas de la vista de proyecto: modelo y lógica pura (sin UI).
 * Permite testear el orden y la pestaña activa por defecto sin jsdom.
 */

export type ProjectTab = 'entregados' | 'borradores' | 'programa' | 'escaneos' | 'recon'

export const PROJECT_TAB_ORDER: ProjectTab[] = ['programa', 'entregados', 'borradores', 'escaneos', 'recon']

/** Pestaña activa por defecto al abrir un proyecto. */
export function defaultProjectTab(): ProjectTab {
  return 'programa'
}