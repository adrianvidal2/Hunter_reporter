import { parseCrawlerUrls, parseHttpxHosts } from './flows'
import { baseDomain, getTool, isValidDomainTarget, isValidUrlTarget, normalizeTarget } from './tools'

/**
 * Plan determinista del pipeline de recon (núcleo PURO: sin procesos, sin
 * disco, sin LLM). Dado el scope del programa decide QUÉ etapas aplican y
 * en qué orden; el orquestador (`server/recon-pipeline.ts`) las ejecuta y
 * el humano aprueba el plan antes de lanzar nada.
 *
 * Forma según el scope (acordada en el plan):
 * - Wildcard (`*.x.com`): enumerar (subfinder → dnsx) → httpx → crawl
 *   (katana) → gf → activo (nuclei).
 * - Host concreto: se salta la enumeración → httpx → crawl → gf → activo.
 * - Mixto: unión; SOLO se enumera en las ramas wildcard.
 * - URLs con ruta: NO se convierten en hosts (el wildcard no se expande y
 *   una URL en scope no declara el host entero): van a la vía de
 *   explotación por URL (sqlmap/dalfox), con su propio gate.
 *
 * Los targets de cada etapa se describen por FUENTE (`source`): la salida
 * de la etapa anterior (`prev`), entradas fijas del scope (`scope`) o la
 * unión de ambas (`union`). El orquestador los calcula al vuelo y SIEMPRE
 * los intersecciona con el scope.
 */

/** De dónde salen los targets de una etapa. */
export type PipelineStageSource = 'prev' | 'scope' | 'union'

export interface PipelineStage {
  /** Herramienta de la lista blanca que ejecuta la etapa. */
  toolId: string
  source: PipelineStageSource
  /** Targets fijos (normalizados) cuando source incluye 'scope'. */
  targets: string[]
  /** Qué se extrae de la salida para alimentar la etapa siguiente. */
  extract: 'hosts' | 'urls' | 'none'
  /** Riesgo active/exploitation → el gate exige confirmación salvo autorización explícita. */
  gated: boolean
}

export interface PipelineScopeShape {
  /** Bases con wildcard (sin `*.`), normalizadas: `*.api.x.com` → `api.x.com`. */
  wildcards: string[]
  /** Dominios concretos, normalizados. */
  hosts: string[]
  /** URLs con ruta (sin esquema), normalizadas: `app.x.com/login`. */
  urls: string[]
  /** Entradas descartadas por forma inválida (transparencia para la UI). */
  invalid: string[]
}

export interface PipelinePlan {
  stages: PipelineStage[]
  shape: PipelineScopeShape
}

export type PipelinePlanResult =
  | { ok: true; plan: PipelinePlan }
  | { ok: false; reason: string }

/** Clasifica el scope normalizado por formas (wildcard / host / URL / inválida). */
export function classifyScope(scope: string[]): PipelineScopeShape {
  const shape: PipelineScopeShape = { wildcards: [], hosts: [], urls: [], invalid: [] }
  const pushUnique = (list: string[], value: string) => {
    if (!list.includes(value)) list.push(value)
  }
  for (const raw of scope) {
    const norm = normalizeTarget(raw)
    if (norm === '') {
      pushUnique(shape.invalid, raw)
      continue
    }
    if (norm.startsWith('*.')) {
      if (isValidDomainTarget(norm)) pushUnique(shape.wildcards, baseDomain(norm))
      else pushUnique(shape.invalid, raw)
      continue
    }
    if (norm.includes('/')) {
      // entrada con ruta: era una URL a la que la normalización quitó el esquema
      if (isValidUrlTarget(`https://${norm}`)) pushUnique(shape.urls, norm)
      else pushUnique(shape.invalid, raw)
      continue
    }
    if (isValidDomainTarget(norm)) pushUnique(shape.hosts, norm)
    else pushUnique(shape.invalid, raw)
  }
  return shape
}

/**
 * ¿Está un HOST dentro del scope, expandiendo SOLO los wildcards declarados?
 * - Entrada exacta del scope → sí.
 * - Subdominio de la base de un wildcard (`dev.api.x.com` bajo `*.api.x.com`) → sí.
 * - El apex de un wildcard NO se da por incluido (conservador: `*.x.com`
 *   no declara `x.com`); lanzarlo es decisión manual en el panel.
 * Un string que empiece por `-` no valida como host, así que jamás puede
 * colarse disfrazado de flag.
 */
export function hostInScope(host: string, scope: string[]): boolean {
  const h = normalizeTarget(host)
  if (h === '' || h.startsWith('-')) return false
  const exact = new Set(scope.map((s) => normalizeTarget(s)))
  if (exact.has(h)) return true
  for (const raw of scope) {
    const norm = normalizeTarget(raw)
    if (!norm.startsWith('*.')) continue
    const base = baseDomain(norm)
    if (h.endsWith(`.${base}`)) return true
  }
  return false
}

/** Host de un item (host suelto o URL con/sin esquema), en minúsculas. */
function itemHost(item: string): string {
  let rest = item.trim()
  const scheme = rest.indexOf('://')
  if (scheme >= 0) rest = rest.slice(scheme + 3)
  rest = rest.split('/')[0] ?? ''
  return (rest.split(':')[0] ?? '').trim().toLowerCase()
}

/**
 * Intersección SERVIDOR-SIDE de items extraídos de una salida de recon
 * (hosts o URLs) contra el scope: se queda con los que demuestran
 * pertenencia por SU HOST (exacto o subdominio de wildcard declarado).
 * Únicas, en orden, preservando la caja del item. Nada fuera del scope
 * puede seguir adelante en el pipeline por este filtro.
 */
export function intersectWithScope(items: string[], scope: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of items) {
    const item = raw.trim()
    if (item === '' || item.startsWith('-')) continue
    if (seen.has(item)) continue
    if (!hostInScope(itemHost(item), scope)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

/** Salidas de las que se extrae una lista de HOSTS (una por línea o URL). */
const HOST_EXTRACTORS = new Set(['subfinder', 'dnsx', 'httpx'])
/** Salidas de las que se extraen URLs (línea plana, JSON de katana, gospider). */
const URL_EXTRACTORS = new Set(['katana', 'gospider', 'gau', 'waybackurls', 'waymore', 'gf'])

/**
 * Items aprovechables de la salida de una etapa del pipeline, o null si la
 * herramienta no produce nada que alimente a la siguiente (nuclei es
 * terminal; nmap/ffuf/sqlmap… no participan en el pipeline).
 */
export function extractPipelineItems(toolId: string, output: string): string[] | null {
  if (HOST_EXTRACTORS.has(toolId)) return parseHttpxHosts(output)
  if (URL_EXTRACTORS.has(toolId)) return parseCrawlerUrls(output)
  return null
}

/** La etapa pasa por el gate (riesgo active/exploitation). */
function isGated(toolId: string): boolean {
  const tool = getTool(toolId)
  if (!tool) throw new Error(`Herramienta fuera de la lista blanca: ${toolId}`)
  return tool.risk === 'active' || tool.risk === 'exploitation'
}

/**
 * Plan de etapas según la forma del scope. NUNCA ejecuta nada: devuelve la
 * propuesta que la UI muestra y el humano edita/aprueba. Scope sin ninguna
 * entrada aprovechable → error claro.
 */
export function planPipeline(scope: string[]): PipelinePlanResult {
  const shape = classifyScope(scope)
  const hasHostLane = shape.wildcards.length > 0 || shape.hosts.length > 0
  if (!hasHostLane && shape.urls.length === 0) {
    return {
      ok: false,
      reason:
        shape.invalid.length > 0
          ? 'El scope no tiene ninguna entrada aprovechable (ni wildcards, ni hosts, ni URLs con ruta)'
          : 'El programa no declara scope: sincroniza los datos del programa primero',
    }
  }

  const stages: PipelineStage[] = []
  if (shape.wildcards.length > 0) {
    stages.push({ toolId: 'subfinder', source: 'scope', targets: shape.wildcards, extract: 'hosts', gated: isGated('subfinder') })
    stages.push({ toolId: 'dnsx', source: 'prev', targets: [], extract: 'hosts', gated: isGated('dnsx') })
  }
  if (hasHostLane) {
    stages.push({
      toolId: 'httpx',
      source: shape.wildcards.length > 0 ? (shape.hosts.length > 0 ? 'union' : 'prev') : 'scope',
      targets: shape.hosts,
      extract: 'hosts',
      gated: isGated('httpx'),
    })
    stages.push({ toolId: 'katana', source: 'prev', targets: [], extract: 'urls', gated: isGated('katana') })
    stages.push({ toolId: 'gf', source: 'prev', targets: [], extract: 'urls', gated: isGated('gf') })
    stages.push({ toolId: 'nuclei', source: 'prev', targets: [], extract: 'none', gated: isGated('nuclei') })
  }
  if (shape.urls.length > 0) {
    for (const toolId of ['sqlmap', 'dalfox'] as const) {
      stages.push({ toolId, source: 'scope', targets: shape.urls, extract: 'none', gated: isGated(toolId) })
    }
  }
  return { ok: true, plan: { stages, shape } }
}
