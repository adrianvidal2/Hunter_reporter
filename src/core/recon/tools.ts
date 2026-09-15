/**
 * Catálogo y recetas del módulo recon (núcleo puro: sin procesos, sin fs).
 *
 * Principios de seguridad (diseño aprobado):
 * - LISTA BLANCA: solo se pueden construir comandos de las herramientas de
 *   este catálogo. La UI manda un toolId, nunca un binario ni argumentos.
 * - Los argumentos se construyen como ARRAY (execFile, sin shell) a partir
 *   de recetas fijas en código. La UI no aporta argumentos libres.
 * - Los targets solo pueden ser dominios/URLs del scope, validados aquí:
 *   un string que empiece por `-` no puede validar como dominio ni URL, así
 *   que no puede colarse en el comando disfrazado de flag (inyección de
 *   argumentos). Además el runner intersecciona contra programa.json.
 * - Rate limits conservadores FIJOS en las recetas: no hay forma de lanzar
 *   en modo agresivo desde la app.
 * - sqlmap NO destructivo por defecto: solo detección (level/risk 1, 1
 *   thread, sin --dump/--os-shell/...). Ver DENIED_SQLMAP_FLAGS.
 * - Nmap solo con flags sin privilegios (sin -sS/-sU/-O/-A; nunca sudo).
 * - Heurística de reglas CONSERVADORA: ante la duda, pedir confirmación.
 */

export type ReconRisk = 'passive' | 'light' | 'active' | 'exploitation'

export const TOOL_IDS = [
  'subfinder', 'gau', 'waybackurls', 'gf',
  'httpx', 'dnsx', 'katana', 'gospider', 'waymore',
  'nmap', 'ffuf', 'gobuster', 'nuclei',
  'sqlmap', 'dalfox',
] as const

export type ToolId = (typeof TOOL_IDS)[number]

/** Cómo interpreta la herramienta los targets del scope. */
export type TargetKind = 'domain' | 'any' // any = dominio o URL

export interface ToolDef {
  id: ToolId
  label: string
  risk: ReconRisk
  /** La herramienta puede enviar el User-Agent obligatorio del programa. */
  supportsUserAgent: boolean
  /** true = opera sobre el scope entero; false = sobre UNA URL concreta. */
  scopeMode: 'scope' | 'url'
  targetKind: TargetKind
  /** Nota fija de rate limit que la UI muestra (los flags van en la receta). */
  rateLimitNote: string
}

export const RECON_TOOLS: ToolDef[] = [
  // ── Pasivas: entran directas, sin aviso ─────────────────────────────
  { id: 'subfinder', label: 'subfinder', risk: 'passive', supportsUserAgent: false, scopeMode: 'scope', targetKind: 'domain', rateLimitNote: 'pasiva (fuentes públicas)' },
  { id: 'gau', label: 'gau', risk: 'passive', supportsUserAgent: false, scopeMode: 'scope', targetKind: 'domain', rateLimitNote: 'pasiva (wayback/otx)' },
  { id: 'waybackurls', label: 'waybackurls', risk: 'passive', supportsUserAgent: false, scopeMode: 'scope', targetKind: 'domain', rateLimitNote: 'pasiva (wayback)' },
  { id: 'gf', label: 'gf', risk: 'passive', supportsUserAgent: false, scopeMode: 'scope', targetKind: 'any', rateLimitNote: 'filtro local, sin tráfico' },

  // ── Tráfico ligero: UA del programa obligatorio + rate conservador ──
  { id: 'httpx', label: 'httpx', risk: 'light', supportsUserAgent: true, scopeMode: 'scope', targetKind: 'any', rateLimitNote: '20 req/s, timeout 5s' },
  { id: 'dnsx', label: 'dnsx', risk: 'light', supportsUserAgent: false, scopeMode: 'scope', targetKind: 'domain', rateLimitNote: 'resolución DNS (sin HTTP)' },
  { id: 'katana', label: 'katana', risk: 'light', supportsUserAgent: true, scopeMode: 'scope', targetKind: 'any', rateLimitNote: '5 conc, depth 3, silent' },
  { id: 'gospider', label: 'gospider', risk: 'light', supportsUserAgent: true, scopeMode: 'scope', targetKind: 'any', rateLimitNote: '5 conc, delay 2s, 10 threads' },
  // waymore en modo U (solo URLs de archivo): el tráfico va a los
  // ARCHIVADORES (web.archive.org), no al target; el rate lo aplican ellos
  { id: 'waymore', label: 'waymore', risk: 'light', supportsUserAgent: false, scopeMode: 'scope', targetKind: 'domain', rateLimitNote: 'solo fuentes de archivo (-mode U), sin descargar respuestas del target' },

  // ── Escaneo activo: gate de confirmación si las reglas lo prohíben ──
  { id: 'nmap', label: 'nmap', risk: 'active', supportsUserAgent: false, scopeMode: 'scope', targetKind: 'domain', rateLimitNote: 'TCP connect (-sT), top 100 puertos, max-rate 150' },
  { id: 'ffuf', label: 'ffuf', risk: 'active', supportsUserAgent: true, scopeMode: 'scope', targetKind: 'any', rateLimitNote: '50 req/s, un comando por target' },
  { id: 'gobuster', label: 'gobuster', risk: 'active', supportsUserAgent: true, scopeMode: 'scope', targetKind: 'any', rateLimitNote: 'delay 100ms, 10 threads, un comando por target' },
  { id: 'nuclei', label: 'nuclei', risk: 'active', supportsUserAgent: true, scopeMode: 'scope', targetKind: 'any', rateLimitNote: '25 conc, 100 req/s' },

  // ── Explotación sobre URL concreta (trato aparte, badge rojo) ───────
  { id: 'sqlmap', label: 'sqlmap', risk: 'exploitation', supportsUserAgent: true, scopeMode: 'url', targetKind: 'any', rateLimitNote: 'NO destructivo: level/risk 1, 1 thread' },
  { id: 'dalfox', label: 'dalfox', risk: 'exploitation', supportsUserAgent: true, scopeMode: 'url', targetKind: 'any', rateLimitNote: '1 URL, detección estándar' },
]

export function getTool(id: string): ToolDef | null {
  return RECON_TOOLS.find((t) => t.id === id) ?? null
}

// ── Validación de targets ───────────────────────────────────────────────

/** Etiqueta de dominio: alfanumérico con guiones internos. */
const LABEL = String.raw`[a-z0-9]([a-z0-9-]*[a-z0-9])?`
/** Dominio con wildcard opcional: `*.api.ejemplo.com`. */
const DOMAIN_RE = new RegExp(String.raw`^\*\.${LABEL}(\.${LABEL})+$`)
/** Dominio sin wildcard. */
const BARE_HOST_RE = new RegExp(String.raw`^${LABEL}(\.${LABEL})+$`)
/** IP v4 (nmap la admite si algún scope la trae). */
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/

/**
 * Dominio (con wildcard opcional). Estricto a propósito: un string que
 * empiece por `-`, contenga espacios, `/`, `;`, `=`… no valida, así que
 * jamás puede llegar al comando disfrazado de flag (inyección de args).
 */
export function isValidDomainTarget(t: string): boolean {
  if (typeof t !== 'string') return false
  const lower = t.trim().toLowerCase()
  if (lower === '' || lower.startsWith('-')) return false
  return DOMAIN_RE.test(lower) || BARE_HOST_RE.test(lower) || IPV4_RE.test(lower)
}

/** URL http(s) con host válido: nada de espacios ni `-` inicial. */
export function isValidUrlTarget(u: string): boolean {
  if (typeof u !== 'string' || u.trim() === '' || u.trim().startsWith('-')) return false
  if (/\s/.test(u)) return false
  try {
    const parsed = new URL(u)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    if (host === '' || host.startsWith('-')) return false
    return BARE_HOST_RE.test(host) || IPV4_RE.test(host)
  } catch {
    return false
  }
}

export function isValidTarget(kind: TargetKind, t: string): boolean {
  if (kind === 'domain') return isValidDomainTarget(t)
  return isValidDomainTarget(t) || isValidUrlTarget(t)
}

/** Dominio base sin wildcard: `*.api.ejemplo.com` → `api.ejemplo.com`. */
export function baseDomain(t: string): string {
  return t.replace(/^\*\./, '')
}

/**
 * Normalización para comparar scope con lo que pide la UI (revisión de
 * recetas): minúsculas, sin protocolo http(s), sin barra final. YWH e
 * Intigriti estructuran el scope distinto (`*.x.com`, `https://x.com/`…):
 * un target legítimo no debe rechazarse por no coincidir byte a byte.
 * El wildcard NO se expande: `*.x.com` solo equivale a sí mismo — no hay
 * ensanchamiento silencioso del scope.
 */
export function normalizeTarget(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
}

/** Validación sobre la forma YA normalizada (sin esquema). */
function isValidNormalizedTarget(kind: TargetKind, normalized: string): boolean {
  if (kind === 'domain') return isValidDomainTarget(normalized)
  if (isValidDomainTarget(normalized)) return true
  // target con ruta: era una URL a la que la normalización quitó el esquema
  if (normalized.includes('/')) return isValidUrlTarget(`https://${normalized}`)
  return isValidUrlTarget(normalized)
}

export type RejectionReason = 'out_of_scope' | 'invalid'

export interface TargetRejection {
  target: string
  reason: RejectionReason
}

export interface TargetResolution {
  accepted: string[]
  rejected: TargetRejection[]
}

/**
 * Intersección SERVIDOR-SIDE contra el scope del programa.json: solo pasan
 * los targets pedidos que estén EXACTAMENTE en el scope in-scope actual
 * (comparando normalizados; el wildcard no se expande). Es la garantía de
 * que un dominio out-of-scope no puede acabar en un comando: el conjunto
 * final no contiene nada que no esté en `scope`. Cada rechazo dice POR QUÉ:
 * `out_of_scope` (no está en el programa) o `invalid` (está pero su forma
 * no es lanzable).
 */
export function resolveTargets(
  kind: TargetKind,
  requested: string[],
  scope: string[],
): TargetResolution {
  const scopeSet = new Set(scope.map(normalizeTarget))
  const accepted: string[] = []
  const rejected: TargetRejection[] = []
  for (const raw of requested) {
    const normalized = normalizeTarget(raw)
    if (!scopeSet.has(normalized)) {
      rejected.push({ target: raw, reason: 'out_of_scope' })
      continue
    }
    if (!isValidNormalizedTarget(kind, normalized)) {
      rejected.push({ target: raw, reason: 'invalid' })
      continue
    }
    accepted.push(normalized)
  }
  return { accepted, rejected }
}

// ── Recetas ─────────────────────────────────────────────────────────────

export interface ToolCommand {
  /** Argumentos EXACTOS (array, execFile sin shell). */
  args: string[]
  /** Targets que entran por stdin (gau/waybackurls/gf/dnsx). */
  stdin?: string
}

export interface ReconCommandOptions {
  /** User-Agent obligatorio del programa (se inyecta si la herramienta lo soporta). */
  userAgent?: string
  /**
   * Fichero de targets (el runner lo crea en el dir de salida y pasa la
   * ruta); obligatorio para las herramientas que van por fichero (-dL/-l/-list/-S).
   */
  targetFile?: string
  /** Wordlist para ffuf/gobuster (configurable en Ajustes). */
  wordlist?: string
}

export class ReconError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReconError'
  }
}

export const DEFAULT_WORDLIST = '/usr/share/wordlists/dirb/common.txt'

function requireTargets(targets: string[]): void {
  if (targets.length === 0) throw new ReconError('Sin targets: nada que lanzar')
}

function requireFile(opts: ReconCommandOptions, toolLabel: string, flag: string): string {
  if (!opts.targetFile) throw new ReconError(`${toolLabel} necesita targetFile (${flag})`)
  return opts.targetFile
}

/** `-H "User-Agent: …"` si la herramienta soporta UA y hay uno. */
function headerUa(opts: ReconCommandOptions): string[] {
  return opts.userAgent ? ['-H', `User-Agent: ${opts.userAgent}`] : []
}

/**
 * Construye el/los comandos EXACTOS de una herramienta del catálogo sobre
 * unos targets YA validados e interseccionados con el scope. Devuelve un
 * array: length 1 salvo los fuzzers por URL (ffuf/gobuster), que generan
 * un comando por target para que el runner los ejecute en secuencia en el
 * MISMO directorio de salida. Nunca ejecuta nada: solo describe comandos.
 */
export function buildToolCommands(
  toolId: string,
  targets: string[],
  opts: ReconCommandOptions = {},
): ToolCommand[] {
  const tool = getTool(toolId)
  if (!tool) throw new ReconError(`Herramienta fuera de la lista blanca: ${toolId}`)
  if (tool.scopeMode === 'url') {
    throw new ReconError(`${tool.label} opera sobre una URL concreta: usa buildUrlToolCommand`)
  }
  requireTargets(targets)

  const allBase = targets.map(baseDomain)
  const stdinJoined = targets.join('\n')
  const baseStdin = allBase.join('\n')

  switch (toolId) {
    case 'subfinder': {
      // Aprobado: subfinder recibe el dominio BASE sin `*.` vía -dL
      const file = requireFile(opts, 'subfinder', '-dL')
      return [{ args: ['-dL', file, '-silent'] }]
    }
    case 'gau':
      return [{ args: ['--threads', '4'], stdin: baseStdin }]
    case 'waybackurls':
      return [{ args: [], stdin: baseStdin }]
    case 'gf':
      throw new ReconError('gf usa buildGfCommand(pattern, urls): el patrón es de lista fija')
    case 'httpx': {
      const file = requireFile(opts, 'httpx', '-l')
      return [{
        args: [
          '-l', file,
          '-rate-limit', '20',
          '-timeout', '5',
          '-silent', '-no-color',
          ...headerUa(opts),
        ],
      }]
    }
    case 'dnsx':
      return [{ args: ['-silent'], stdin: baseStdin }]
    case 'katana': {
      const file = requireFile(opts, 'katana', '-list')
      return [{
        args: [
          '-list', file,
          '-c', '5',
          '-d', '3',
          '-silent', '-no-color', '-jc',
          ...headerUa(opts),
        ],
      }]
    }
    case 'gospider': {
      const file = requireFile(opts, 'gospider', '-S')
      return [{
        args: [
          '-S', file,
          '-c', '5',
          '-d', '2',
          '-t', '10',
          '--blacklist', 'woff|woff2|ttf|svg|jpeg|jpg|png|gif|webp|mp4',
          ...(opts.userAgent ? ['-u', opts.userAgent] : []),
        ],
      }]
    }
    case 'waymore': {
      // Receta base SOLO fuentes de archivo: -mode U (URLs, sin descargar
      // respuestas), reintentos ante rate limit de los archivadores, y el
      // fichero de links al dir de salida (cwd del proceso). Sin UA: el
      // tráfico va a los archivadores, no al target.
      const file = requireFile(opts, 'waymore', '-i (fichero de dominios)')
      return [{
        args: [
          '-i', file,
          '-mode', 'U',
          '-r', '3',
          '-oU', 'urls.txt',
        ],
      }]
    }
    case 'nmap': {
      // SOLO flags sin privilegios: -sT (TCP connect), jamás -sS/-sU/-O/-A,
      // jamás sudo (la app no eleva nunca). Sin -oN: stdout capturado.
      return [{
        args: [
          '-sT', '-Pn',
          '--top-ports', '100',
          '--max-rate', '150',
          '--open',
          ...allBase,
        ],
      }]
    }
    case 'ffuf': {
      const wordlist = opts.wordlist ?? DEFAULT_WORDLIST
      return allBase.map((base) => ({
        args: [
          '-u', `https://${base}`,
          '-w', wordlist,
          '-rate', '50',
          '-s',
          ...headerUa(opts),
        ],
      }))
    }
    case 'gobuster': {
      const wordlist = opts.wordlist ?? DEFAULT_WORDLIST
      return allBase.map((base) => ({
        args: [
          'dir',
          '-u', `https://${base}`,
          '-w', wordlist,
          '-t', '10',
          '--delay', '100ms',
          '--no-progress', '--quiet',
          ...headerUa(opts),
        ],
      }))
    }
    case 'nuclei': {
      const file = requireFile(opts, 'nuclei', '-l')
      return [{
        args: [
          '-l', file,
          '-c', '25',
          '-rl', '100',
          '-silent', '-no-color', '-nc',
          ...headerUa(opts),
        ],
      }]
    }
    default:
      throw new ReconError(`Herramienta de scope sin receta: ${toolId}`)
  }
}

// ── gf (filtro local con patrones de lista fija) ────────────────────────

export const GF_PATTERNS = ['xss', 'sqli', 'ssrf', 'redirect', 'rce', 'lfi'] as const

/** gf: filtra URLs por stdin con un patrón de la lista fija (nada libre). */
export function buildGfCommand(pattern: string, urls: string[]): ToolCommand {
  if (!(GF_PATTERNS as readonly string[]).includes(pattern)) {
    throw new ReconError(`Patrón gf fuera de la lista: ${pattern}`)
  }
  requireTargets(urls)
  return { args: [pattern], stdin: urls.join('\n') }
}

// ── Explotación sobre URL concreta (sqlmap / dalfox) ────────────────────

/**
 * sqlmap MODO NO DESTRUCTIVO (requisito explícito): solo DETECCIÓN.
 * - level=1, risk=1 (explícitos), 1 thread, timeouts suaves.
 * - PROHIBIDO en esta receta: --dump/--dump-all (extracción masiva),
 *   --os-shell/--sql-shell/--os-pwn (segundo orden), --file-*, y cualquier
 *   --level/--risk > 1 (ver assertSqlmapNonDestructive). Subir el nivel
 *   exige receta nueva revisada, no un click.
 * - --batch solo evita prompts interactivos; sin --dump no extrae nada.
 */
export function buildSqlmapCommand(url: string, opts: ReconCommandOptions = {}): ToolCommand {
  if (!isValidUrlTarget(url)) throw new ReconError(`URL inválida para sqlmap: ${url}`)
  return {
    args: [
      '--url', url,
      '--batch',
      '--level=1', '--risk=1',
      '--threads=1',
      '--timeout=15', '--retries=2',
      '--no-cast', '--no-escape',
      '--flush-session',
      ...(opts.userAgent ? [`--user-agent=${opts.userAgent}`] : []),
    ],
  }
}

/** dalfox sobre UNA URL concreta: detección XSS estándar, sin agresivos. */
export function buildDalfoxCommand(url: string, opts: ReconCommandOptions = {}): ToolCommand {
  if (!isValidUrlTarget(url)) throw new ReconError(`URL inválida para dalfox: ${url}`)
  return {
    args: [
      'url', url,
      '--no-color', '--no-spinner', '--silence',
      ...headerUa(opts),
    ],
  }
}

export function buildUrlToolCommand(
  toolId: string,
  url: string,
  opts: ReconCommandOptions = {},
): ToolCommand {
  if (toolId === 'sqlmap') return buildSqlmapCommand(url, opts)
  if (toolId === 'dalfox') return buildDalfoxCommand(url, opts)
  throw new ReconError(`La herramienta ${toolId} no es de URL concreta`)
}

/** Flags que NUNCA pueden aparecer en la receta no destructiva de sqlmap. */
export const DENIED_SQLMAP_FLAGS = [
  '--dump', '--dump-all', '--dump-table',
  '--os-shell', '--sql-shell', '--os-pwn', '--os-smbrelay', '--os-bof',
  '--file-read', '--file-write', '--file-dest',
] as const

/** Guard testeable: la receta base de sqlmap es de detección, no explotación. */
export function assertSqlmapNonDestructive(args: string[]): void {
  for (const a of args) {
    const flag = a.split('=')[0]!
    if ((DENIED_SQLMAP_FLAGS as readonly string[]).includes(flag)) {
      throw new ReconError(`sqlmap no destructivo: flag prohibido ${flag}`)
    }
    if (/^--level=([2-9]|\d{2,})$/.test(a)) {
      throw new ReconError('sqlmap no destructivo: level máx 1')
    }
    if (/^--risk=([2-9]|\d{2,})$/.test(a)) {
      throw new ReconError('sqlmap no destructivo: risk máx 1')
    }
    if (/^--threads=([2-9]|\d{2,})$/.test(a)) {
      throw new ReconError('sqlmap no destructivo: máx 1 thread')
    }
  }
}

// ── Heurística de reglas del programa (tres estados, CONSERVADORA) ──────

export interface ProgramRulesInput {
  /** Texto de reglas (YWH rules / ROE description de Intigriti). */
  rulesText?: string | null
  /**
   * Intigriti: `automatedTooling` del ROE. `undefined` = plataforma sin el
   * campo (YWH, se evalúa solo el texto); `null` = campo ausente/vacío en
   * un programa Intigriti; 0 = sin restricción declarada; cualquier otro
   * valor = restricción explícita.
   */
  automatedTooling?: number | null
}

/**
 * Veredicto de tres estados (aprobado en la revisión del gate):
 * - 'explicitly_allowed': las reglas AUTORIZAN explícitamente la
 *   automatización (o Intigriti declara automatedTooling=0) → escaneo
 *   activo sin confirmación.
 * - 'prohibited': las reglas prohíben/restringen explícitamente.
 * - 'silent': las reglas no dicen nada aplicable → CONSERVADOR, se pide
 *   confirmación. Silencio = confirmar, NUNCA vía libre.
 */
export type ToolingVerdictState = 'explicitly_allowed' | 'prohibited' | 'silent'

export interface ToolingVerdict {
  state: ToolingVerdictState
  reason: string
  /** Fragmento de las reglas que disparó la detección (para la UI/run.json). */
  matchedText?: string
}

/** Patrones que PROHÍBEN o restringen la automatización (case-insensitive). */
const PROHIBITION_PATTERNS: RegExp[] = [
  /no\s+(automated|automatic)\s+(scanning|scanners?|tools?|tooling)/i,
  /without\s+((prior|written|explicit)\s+)*(permission|authorization|consent)[^.]{0,80}automat/i,
  /automat\w*[^.]{0,60}without\s+((prior|written|explicit)\s+)*(permission|authorization|consent)/i,
  /automat\w*[^.]{0,80}(only|exclusively)[^.]{0,40}\b(with|after)\s+((prior|written|explicit)\s+)*(permission|authorization|consent|approval)/i,
  /prohibit\w*[^.]{0,40}(automated|automatic|scanner|scanning|fuzz)/i,
  /(scanner|scanning|fuzzing|automated|automatic)[^.]{0,30}\b(is|are)\s+(strictly\s+)?(not\s+allowed|not permitted|prohibited|forbidden|banned|disallowed)/i,
  /(don'?t|do not|must not|may not|not allowed to)\s+(use\s+|run\s+|launch\s+)?(automated|automatic|scanner|scanning|fuzz|nmap|nuclei|sqlmap|burp)/i,
  /\bno\s+(scanners?|fuzzing|vulnerability scanning|intrusive scanning)\b/i,
  /only\s+manual\s+(testing|testing is allowed)/i,
]

/** Patrones que AUTORIZAN explícitamente la automatización (levantan el gate). */
const ALLOWANCE_PATTERNS: RegExp[] = [
  /automated\s+(scanning|testing|tools?|tooling)( is | are )?(allowed|permitted|authorized|authorised|encouraged|welcome)/i,
  /(feel free|you (may|can)|we encourage)[^.]{0,40}(use|run|launch)?[^.]{0,20}automat/i,
  /(allowed|permitted|authorized|authorised|encouraged)[^.]{0,30}automated\s+(scanning|tools|tooling)/i,
  /automated\s+(scanning|testing|tools)[^.]{0,40}(in\s+scope|within\s+scope|is\s+in\s+scope)/i,
]

function matchSnippet(text: string, re: RegExp): string | undefined {
  const m = re.exec(text)
  if (!m) return undefined
  const start = Math.max(0, m.index - 40)
  return text
    .slice(start, Math.min(text.length, m.index + m[0].length + 60))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Veredicto de tres estados sobre las reglas del programa. CONSERVADOR:
 * el estado por defecto ante texto no concluyente es 'silent', que para
 * herramientas active/exploitation pide confirmación (needsGate).
 */
export function assessAutomatedTooling(input: ProgramRulesInput): ToolingVerdict {
  // Intigriti: campo estructurado con prioridad.
  if (input.automatedTooling !== undefined && input.automatedTooling !== null) {
    const text = input.rulesText ?? ''
    if (input.automatedTooling !== 0) {
      return {
        state: 'prohibited',
        reason: `Las reglas restringen el tooling automatizado (automatedTooling=${input.automatedTooling})`,
      }
    }
    // 0 = sin restricción declarada; una prohibición en el texto sigue mandando
    for (const re of PROHIBITION_PATTERNS) {
      const snippet = matchSnippet(text, re)
      if (snippet) {
        return { state: 'prohibited', reason: 'Las reglas contienen una prohibición de herramientas automatizadas', matchedText: snippet }
      }
    }
    return {
      state: 'explicitly_allowed',
      reason: 'Las reglas declaran automatedTooling=0 (sin restricción de tooling)',
    }
  }
  if (input.automatedTooling === null) {
    return {
      state: 'silent',
      reason: 'Las reglas no declaran política de tooling automatizado: confirmación requerida',
    }
  }

  // YWH (sin campo estructurado): primero prohibición, luego autorización explícita.
  const text = input.rulesText ?? ''
  if (text.trim() === '') {
    return { state: 'silent', reason: 'Sin texto de reglas que evaluar: confirmación requerida' }
  }
  for (const re of PROHIBITION_PATTERNS) {
    const snippet = matchSnippet(text, re)
    if (snippet) {
      return { state: 'prohibited', reason: 'Las reglas contienen una prohibición de herramientas automatizadas', matchedText: snippet }
    }
  }
  for (const re of ALLOWANCE_PATTERNS) {
    const snippet = matchSnippet(text, re)
    if (snippet) {
      return { state: 'explicitly_allowed', reason: 'Las reglas autorizan explícitamente la automatización', matchedText: snippet }
    }
  }
  return {
    state: 'silent',
    reason: 'Las reglas no autorizan explícitamente la automatización: confirmación requerida',
  }
}

/**
 * ¿Esta herramienta necesita pasar el gate de confirmación?
 * active/exploitation: SIEMPRE salvo 'explicitly_allowed' (aprobado:
 * silencio = confirmar). Pasivas y ligeras: nunca.
 */
export function needsGate(toolId: string, verdict: ToolingVerdict): boolean {
  const tool = getTool(toolId)
  if (!tool) throw new ReconError(`Herramienta fuera de la lista blanca: ${toolId}`)
  if (tool.risk !== 'active' && tool.risk !== 'exploitation') return false
  return verdict.state !== 'explicitly_allowed'
}

// ── Aviso de apex para fuzzers (aprobado: httpx → ffuf/gobuster) ────────

/**
 * Aviso para ffuf/gobuster: fzzeear el apex de un scope declarado con
 * wildcard suele fzzeear donde no hay contenido. La UI debe ofrecer los
 * HOSTS VIVOS del último httpx como targets preferentes; este aviso va a
 * run.json y a la pantalla cuando solo hay apex/base de wildcard.
 */
export function fuzzTargetWarning(
  toolId: string,
  targets: string[],
  scope: string[],
): string | null {
  const tool = getTool(toolId)
  if (!tool || (toolId !== 'ffuf' && toolId !== 'gobuster')) return null
  const wildcardBases = new Set(
    scope.filter((s) => normalizeTarget(s).startsWith('*.')).map((s) => baseDomain(normalizeTarget(s))),
  )
  const hits = targets.map(normalizeTarget).filter((t) => wildcardBases.has(t))
  if (hits.length === 0) return null
  return (
    `Estás fzzeando el apex (${hits.join(', ')}) de un scope declarado con wildcard: ` +
    'probablemente el contenido está en subdominios vivos. Lanza httpx primero y ' +
    'usa sus hosts vivos como targets del fuzzer.'
  )
}
