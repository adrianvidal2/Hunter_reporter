/**
 * Endpoints/params de JS → OpenAPI (Tarea 7b). Núcleo PURO.
 *
 * Determinista y de ALTA PRECISIÓN en literales: solo se extrae lo que es
 * inequívoco (primer argumento string de fetch/axios, `.open("METHOD", "…")`
 * de XHR, plantillas de ruta SIN interpolación, URLs absolutas http(s)).
 *
 * Lo dinámico NO se adivina: plantillas con `${}`, concatenaciones y rutas
 * relativas sin base van a `gaps` con el fragmento de origen, para que el
 * agente (07e) las ataque. Precisión documentada: cualquier string fuera de
 * un contexto de llamada reconocido NO genera endpoint (mejor perder
 * algún endpoint que inventar rutas).
 *
 * El OpenAPI resultante es un INVENTARIO reconstruido, no un contrato
 * verificado: cada operation lo marca (`description` + `x-recon`).
 */

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])
type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options'

export interface JsEndpoint {
  method: HttpMethod
  /** Path del endpoint (query fuera, va en queryParams). */
  path: string
  queryParams: string[]
  /** Claves literales detectadas en body (axios data:) — pueden estar vacías. */
  bodyProps: string[]
  /** Ficheros fuente donde se vio (dedup une). */
  from: string[]
}

export interface JsEndpointGap {
  /** Fragmento de origen recortado (~160 chars): pistas para el agente. */
  snippet: string
  reason: 'dynamic-template' | 'concatenation' | 'relative-no-base'
  from: string
}

export interface JsApiModel {
  endpoints: JsEndpoint[]
  gaps: JsEndpointGap[]
}

/** Fuente de la que extraer: fichero reconstruido (07a) o JS crudo. */
export interface JsSourceText {
  name: string
  content: string
}

// ── Utilidades de parseo ────────────────────────────────────────────────

function normalizeMethod(raw: string | undefined, fallback: HttpMethod = 'get'): HttpMethod {
  const m = raw?.trim().toLowerCase()
  return m && HTTP_METHODS.has(m) ? (m as HttpMethod) : fallback
}

/** Path literal → { path, queryParams }; null si no es utilizable tal cual. */
function parseLiteralPath(raw: string): { path: string; query: string[] } | null {
  let value = raw.trim()
  if (value === '' || value.includes('${')) return null

  // URL absoluta http(s): nos quedamos con pathname+search (la base va a servers)
  if (/^https?:\/\//i.test(value)) {
    try {
      const u = new URL(value)
      value = `${u.pathname}${u.search}`
    } catch {
      return null
    }
  }
  if (!value.startsWith('/')) return null // relativa sin base → gap (no se adivina)
  if (/[\s<>{}\\]/.test(value)) return null // claramente no es una ruta limpia

  const qIdx = value.indexOf('?')
  const path = qIdx >= 0 ? value.slice(0, qIdx) : value
  const query: string[] = []
  if (qIdx >= 0) {
    const qs = value.slice(qIdx + 1)
    for (const pair of qs.split('&')) {
      if (pair === '') continue
      const key = pair.split('=')[0]?.trim()
      if (key !== '' && !query.includes(key)) query.push(key)
    }
  }
  return { path: path.replace(/\/+$/, '') || '/', query }
}

/** Claves literales de un objeto inline, con o sin llamada intermedia:
 *  `data: {a: 1}` y `body: JSON.stringify({a: 1})` → [a]. */
function objectKeys(objectText: string | undefined, key: string): string[] {
  if (!objectText) return []
  const m = new RegExp(`${key}\\s*:\\s*(?:[A-Za-z_$][\\w.$]*\\s*\\()?\\{([^}]*)\\}`).exec(objectText)
  if (!m) return []
  return [...m[1]!.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)]
    .map((k) => k[1]!)
    .filter((k, i, arr) => arr.indexOf(k) === i)
}

/** Method de un objeto de opciones fetch/axios (`method: "post"`). */
function optionMethod(objectText: string | undefined): HttpMethod | undefined {
  if (!objectText) return undefined
  const m = /method\s*:\s*["'`](\w+)["'`]/i.exec(objectText)
  return m ? normalizeMethod(m[1]) : undefined
}

// ── Extracción ──────────────────────────────────────────────────────────

/**
 * String literal JS ("…" / '…' / `…` sin saltos), con GRUPOS NOMBRADOS:
 * al incrustar STR en regex mayores, `\k<q>` sigue refiriendo a su grupo
 * (las referencias numeradas se romperían al cambiar la numeración).
 */
const STR = '(?<q>["\'`])(?<str>(?:(?!\\k<q>)[^\\\\\\n]|\\\\.)*)\\k<q>'

export function extractEndpoints(sources: JsSourceText[]): JsApiModel {
  const endpoints = new Map<string, JsEndpoint>()
  const gaps: JsEndpointGap[] = []

  const addEndpoint = (
    ep: { method: HttpMethod; path: string; query: string[]; bodyProps: string[] },
    from: string,
  ): void => {
    const key = `${ep.method} ${ep.path}`
    const existing = endpoints.get(key)
    if (!existing) {
      endpoints.set(key, { ...ep, queryParams: [...ep.query], bodyProps: [...ep.bodyProps], from: [from] })
      return
    }
    for (const q of ep.query) if (!existing.queryParams.includes(q)) existing.queryParams.push(q)
    for (const b of ep.bodyProps) if (!existing.bodyProps.includes(b)) existing.bodyProps.push(b)
    if (!existing.from.includes(from)) existing.from.push(from)
  }

  const addGap = (snippet: string, reason: JsEndpointGap['reason'], from: string): void => {
    gaps.push({ snippet: snippet.replace(/\s+/g, ' ').trim().slice(0, 160), reason, from })
  }

  /** Literal o template SIN interpolación → parse; template con ${} → hueco dinámico. */
  const handleLiteral = (raw: string, whole: string, from: string): { path: string; query: string[] } | null => {
    if (raw.includes('${')) {
      addGap(whole, 'dynamic-template', from)
      return null
    }
    const parsed = parseLiteralPath(raw)
    if (!parsed) addGap(whole, 'relative-no-base', from)
    return parsed
  }

  for (const source of sources) {
    const from = source.name
    const text = source.content

    // 1) fetch("<literal>"[, { method, body }]) — también template sin interpolación
    const fetchLit = new RegExp(`\\bfetch\\s*\\(\\s*${STR}\\s*(?:,\\s*(?<opts>[\\s\\S]{0,200}?))?\\)`, 'g')
    for (const m of text.matchAll(fetchLit)) {
      const parsed = handleLiteral(m.groups!.str!, m[0], from)
      if (!parsed) continue
      addEndpoint(
        {
          method: optionMethod(m.groups!.opts) ?? 'get',
          path: parsed.path,
          query: parsed.query,
          bodyProps: objectKeys(m.groups!.opts, 'body'),
        },
        from,
      )
    }

    // 2) axios.get/post/…("<literal>") y axios("<literal>", { url?… })
    const axiosNamed = new RegExp(
      `\\baxios\\s*\\.\\s*(?<method>get|post|put|patch|delete|head|options)\\s*\\(\\s*${STR}`,
      'gi',
    )
    for (const m of text.matchAll(axiosNamed)) {
      const parsed = handleLiteral(m.groups!.str!, m[0], from)
      if (!parsed) continue
      addEndpoint({ method: normalizeMethod(m.groups!.method), path: parsed.path, query: parsed.query, bodyProps: [] }, from)
    }
    const axiosPlain = new RegExp(`\\baxios\\s*\\(\\s*${STR}\\s*(?:,\\s*(?<opts>[\\s\\S]{0,200}?))?\\)`, 'g')
    for (const m of text.matchAll(axiosPlain)) {
      const parsed = handleLiteral(m.groups!.str!, m[0], from)
      if (!parsed) continue
      addEndpoint(
        {
          method: optionMethod(m.groups!.opts) ?? 'get',
          path: parsed.path,
          query: parsed.query,
          bodyProps: objectKeys(m.groups!.opts, 'data'),
        },
        from,
      )
    }

    // 2b) axios({ url: "<literal>", method, data/params }) — objeto inline
    const axiosObj = new RegExp('\\baxios\\s*\\(\\s*\\{(?<opts>[\\s\\S]{0,300}?)\\}\\s*\\)', 'g')
    for (const m of text.matchAll(axiosObj)) {
      const opts = ` ${m.groups!.opts} `
      const urlLiteral = new RegExp(`\\burl\\s*:\\s*${STR}`).exec(opts)
      if (!urlLiteral) continue // sin url literal no hay nada que extraer aquí
      const parsed = handleLiteral(urlLiteral.groups!.str!, m[0], from)
      if (!parsed) continue
      addEndpoint(
        {
          method: optionMethod(opts) ?? 'get',
          path: parsed.path,
          query: [...parsed.query, ...objectKeys(opts, 'params').filter((p) => !parsed.query.includes(p))],
          bodyProps: objectKeys(opts, 'data'),
        },
        from,
      )
    }

    // 3) XHR: .open("METHOD", "<literal>") — el method delante da precisión
    const xhrOpen = new RegExp(
      `\\.\\s*open\\s*\\(\\s*(?<qm>["'\`])(?<method>get|post|put|patch|delete|head|options)\\k<qm>\\s*,\\s*${STR}`,
      'gi',
    )
    for (const m of text.matchAll(xhrOpen)) {
      const parsed = handleLiteral(m.groups!.str!, m[0], from)
      if (!parsed) continue
      addEndpoint({ method: normalizeMethod(m.groups!.method), path: parsed.path, query: parsed.query, bodyProps: [] }, from)
    }

    // 4) HUECOS — lo dinámico no se adivina, se registra con su fragmento
    //    a) concatenación de strings en la llamada (fetch/axios)
    const concat = /\b(?:fetch\s*\(|axios[\w.\s]{0,40}\()\s*[\s\S]{0,120}?["'`]\s*\+\s*[\w.$]/g
    for (const m of text.matchAll(concat)) addGap(m[0], 'concatenation', from)
  }

  return {
    endpoints: [...endpoints.values()],
    gaps,
  }
}

// ── OpenAPI ─────────────────────────────────────────────────────────────

export interface BuildOpenApiOptions {
  /** Título del documento (p. ej. "API reconstruida de ejemplo.com"). */
  title?: string
  /** URL(s) de server para el documento (origen del JS objetivo). */
  serverUrl?: string
}

/**
 * Construye el documento OpenAPI 3.0.3 del inventario. HONESTO por
 * diseño: cada operation declara que es reconstruido de JS y SIN
 * verificar contra el objetivo (`description` + `x-recon`).
 */
export function buildOpenApi(model: JsApiModel, opts: BuildOpenApiOptions = {}): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const ep of model.endpoints) {
    const opIdBase = `${ep.method}_${ep.path.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`
    const operation: Record<string, unknown> = {
      operationId: opIdBase,
      description: 'Reconstruido por análisis de JS (estático). SIN verificar contra el objetivo.',
      responses: {
        '200': { description: 'Respuesta esperada (inferida; sin verificación)' },
      },
      'x-recon': { from: ep.from, gap: false },
    }
    if (ep.queryParams.length > 0) {
      operation.parameters = ep.queryParams.map((name) => ({
        name,
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Detectado como literal en el JS (valor de ejemplo no verificado)',
      }))
    }
    if (ep.bodyProps.length > 0) {
      operation.requestBody = {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: Object.fromEntries(ep.bodyProps.map((p) => [p, { type: 'string' }])),
            },
            description: 'Claves detectadas como literales en el JS',
          },
        },
      }
    }
    paths[ep.path] ??= {}
    paths[ep.path][ep.method] = operation
  }

  const doc: Record<string, unknown> = {
    openapi: '3.0.3',
    info: {
      title: opts.title ?? 'API reconstruida desde JS (recon 7b)',
      version: '0.0.0',
      description:
        'Inventario reconstruido a partir de literales en JS: alta precisión, cobertura PARCIAL. ' +
        'Lo dinámico está en gaps.json (no se adivina). Sin verificación contra el objetivo.',
    },
    paths,
  }
  if (opts.serverUrl) doc.servers = [{ url: opts.serverUrl }]
  return doc
}
