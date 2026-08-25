/**
 * Motor de placeholders (paso 7.2).
 *
 * Sintaxis: `{{clave}}` (se toleran espacios: `{{ clave }}`).
 *
 * Reglas:
 * - Placeholder SIN valor → queda literal (`{{clave}}`): visible en el
 *   resultado, para que falte a la vista y no se pierda en silencio.
 * - Placeholder REPETIDO → se sustituyen todas las ocurrencias.
 * - ESCAPADO: `\{{clave}}` → se emite `{{clave}}` literal, sin sustituir
 *   (la barra se consume: es la forma de "imprimir" un placeholder).
 */

const PLACEHOLDER = /\\?\{\{\s*([^{}\s][^{}]*?)\s*\}\}/g

export function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(PLACEHOLDER, (match, key: string) => {
    if (match.startsWith('\\')) {
      // escapado: \{{clave}} → {{clave}} literal
      return match.slice(1)
    }
    return key in values ? values[key]! : match // ausente → literal
  })
}

/** Placeholders que aparecen en la plantilla (sin escapar), en orden. */
export function templatePlaceholders(template: string): string[] {
  const out: string[] = []
  for (const match of template.matchAll(PLACEHOLDER)) {
    if (!match[0]!.startsWith('\\')) out.push(match[1]!)
  }
  return out
}
