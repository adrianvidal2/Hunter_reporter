import { renderTemplate } from '../reports/placeholders'
import type { JsEndpointGap } from './js-endpoints'
import type { DeterministicPrimitive, Hypothesis } from './primitives'

/**
 * Semilla de misión + handoff A→B (Tarea 7e). Núcleo PURO: ensambla el
 * prompt de misión para el agente a partir del prompt real del usuario
 * (plantilla editable) y la salida determinista de 07a–07d.
 *
 * - La plantilla usa placeholders `{{clave}}` (motor de 7.2): lo que no
 *   tiene datos se marca "(sin …)" — nunca se inventa contenido.
 * - Los HUECOS se señalan EXPLÍCITAMENTE (rutas dinámicas sin resolver,
 *   JS sin sourcemap): es donde el agente gana su sueldo.
 * - ENSAMBLAR ≠ EJECUTAR: esta función solo devuelve texto. El disparo lo
 *   da el humano desde el asistente Lanzar (6c); lo activo lo hace el
 *   agente tras ese clic.
 */

export const DEFAULT_MISSION_TEMPLATE = `## Misión: auditoría del JS de {{proyecto}}

Eres un agente de bug bounty. Tu misión: auditar el JavaScript del objetivo a partir del
recon adjunto (reconstrucción estática determinista), atacando PRIMERO los huecos señalados
y después la superficie activa. Lo que el análisis estático no pudo resolver son tus
objetivos prioritarios.

### Alcance (solo esto es válido — fuera, NADA)
{{scope}}

### Superficie reconstruida (OpenAPI determinista)
{{openapi}}

### Primitivas deterministas (señales claras, SIN confirmar)
{{primitivas}}

### Hipótesis priorizadas (LLM — leads, NO hechos)
{{hipotesis}}

### Secretos candidatos
{{secretos}}

### HUECOS — aquí es donde ganas tu sueldo
{{huecos}}

### Plan de prueba sugerido
1. Verifica los endpoints del OpenAPI contra el objetivo real: ¿existen? ¿responden? ¿los
   parámetros detectados son los reales?
2. Resuelve los HUECOS dinámicos (rutas construidas, JS sin sourcemap): playwright/DOM si
   hace falta. Cada ruta dinámica resuelta es un hallazgo en sí mismo.
3. Prueba SQLi/BOLA en los endpoints con id (SOLO lectura: GET, sin dumping masivo).
4. Confirma o descarta los secretos candidatos: ¿siguen vivos? ¿qué accesos abren?
5. DOM: busca sinks (postMessage, innerHTML, eval) en el JS sin sourcemap.

### Reglas inviolables
- NUNCA borres cuentas, datos ni ejecutes acciones destructivas (no borrar cuenta, no
  DELETE masivo, no dumping).
- Fuera del scope declarado arriba, NADA.
- Todo lo que reportes lleva EVIDENCIA (request/response real), no especulación.
- Los leads del LLM son hipótesis: verifícalos antes de creerlos.
- Respeta el rate limit y el User-Agent del programa.`

export interface MissionData {
  project: string
  scope: string[]
  /** Contenido del openapi.json (salida 07b) o null si no hay. */
  openapiJson?: string | null
  primitivas: DeterministicPrimitive[]
  hipotesis: Hypothesis[]
  /** Prerrenderizado que SUSTITUYE la lista (p. ej. cuerpos KB de 07d). */
  hipotesisTexto?: string
  /** Secretos CANDIDATOS de 07c (el ruido no entra en la misión). */
  secretos: { kind: string; value: string; confidence: string }[]
  /** Gaps deterministas de 07b. */
  huecos: JsEndpointGap[]
  /** URLs de JS SIN sourcemap o no leídos (cobertura 07a): hueco de cobertura. */
  jsSinMap?: string[]
}

const NO_DATA = '(sin datos para esta sección)'

function formatList(items: string[], empty: string): string {
  return items.length === 0 ? empty : items.map((i) => `- ${i}`).join('\n')
}

/**
 * Ensambla la misión: plantilla + datos → prompt para el agente. PURO:
 * devuelve texto y nada más (ensamblar ≠ ejecutar). Sin datos para una
 * sección → "(sin datos para esta sección)": los huecos, en cambio, se
 * señalan siempre que existan.
 */
export function buildMission(data: MissionData, template: string = DEFAULT_MISSION_TEMPLATE): string {
  const values: Record<string, string> = {
    proyecto: data.project,
    scope: formatList(
      data.scope.map((s) => `\`${s}\``),
      NO_DATA,
    ),
    openapi: data.openapiJson?.trim() ? data.openapiJson.trim() : NO_DATA,
    primitivas: formatList(
      data.primitivas.map((p) => `**${p.kind}** → \`${p.target}\` — ${p.signal}`),
      NO_DATA,
    ),
    hipotesis: data.hipotesisTexto ?? formatList(
      data.hipotesis.map(
        (h) =>
          `**${h.title}** (${h.kind}, probabilidad ${Math.round(h.probabilidad * 100)}%) → \`${h.target}\` — ${h.razon}`,
      ),
      NO_DATA,
    ),
    secretos: formatList(
      data.secretos.map((s) => `**${s.kind}** → \`${s.value.slice(0, 80)}\``),
      '(sin secretos candidatos)',
    ),
    huecos: [
      ...(data.huecos.length > 0
        ? data.huecos.map((g) => `- [${g.reason}] \`${g.snippet}\``)
        : []),
      ...(data.jsSinMap ?? []).map((u) => `- [js-sin-sourcemap] \`${u}\``),
    ].join('\n') || NO_DATA,
  }
  return renderTemplate(template, values)
}
