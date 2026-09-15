/**
 * Lógica de Orca (modo "Orca" del botón Lanzar). Dos capas:
 *
 * - Parsing PURO (testeable sin binario): extraer el JSON de `--json` de un
 *   stdout que viene mezclado con logs (Orca pinta a stdout logs y a stderr
 *   logs de runtime; el resultado con --json es una línea/bloque JSON).
 * - Runner: ejecuta el binario (`status`, `open`, `worktree create`) con
 *   `execFile`. En tests se inyecta una implementación falsa.
 */

export interface OrcaStatus {
  /** Derivado de `result.runtime.reachable` (true = Orca listo). */
  runtimeReachable: boolean
  /** `result.runtime.state` (p. ej. 'ready') cuando viene. */
  runtimeState?: string
  /** `result.app.running` cuando viene. */
  appRunning?: boolean
}

export interface OrcaWorktreeResult {
  ok: boolean
  /** handle(s) del worktree creado. */
  handle?: string
  agentTerminalHandle?: string
  worktreeId?: string
  /** mensaje de error cuando ok=false. */
  message?: string
}

/** Tipos de fallo conocidos (para mapear avisos amables). */
export type OrcaFailureKind =
  | 'repo_not_found'
  | 'unknown_agent'
  | 'other'

/**
 * Normaliza un valor de error a TEXTO legible. El mensaje de `worktree
 * create` puede venir en varias formas: string, objeto `{message}`,
 * objeto serializable, null/undefined. Nunca debe crashear el parser.
 */
export function errorText(value: unknown): string {
  if (typeof value === 'string') {
    const m = value.trim()
    if (m !== '') return m
  }
  if (value == null) return ''
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const msg = typeof obj.message === 'string' ? obj.message.trim() : ''
    if (msg !== '') return msg
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value).trim()
}

/** Tipos de fallo conocidos (para mapear avisos amables). Acepta valor
 *  de cualquier forma y NO crashea: primero aplanamos a texto. */
export function classifyOrcaMessage(message: unknown): OrcaFailureKind {
  const m = errorText(message).toLowerCase()
  if (m.includes('repo_not_found') || m.includes('repo not found')) return 'repo_not_found'
  if (m.includes('unknown tui agent')) return 'unknown_agent'
  return 'other'
}

/**
 * Extrae el primer objeto JSON válido de un string que puede tener ruido
 * (logs antes/después, bloques sueltos). Busca secuencialmente cada `{` y
 * para cada uno intenta parsear con un balanceador de llaves; si un bloque
 * está malformado, sigue desde la siguiente `{`.
 */
export function extractJsonBlock(stdout: string): unknown | null {
  if (!stdout) return null
  for (let i = 0; i < stdout.length; i++) {
    if (stdout[i] !== '{') continue
    let depth = 0
    let inStr = false
    let esc = false
    let closed = false
    let end = -1
    for (let j = i; j < stdout.length; j++) {
      const ch = stdout[j]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          closed = true
          end = j
          break
        }
      }
    }
    if (!closed) continue // bloque sin cerrar en este stdout → no válido
    try {
      return JSON.parse(stdout.slice(i, end + 1))
    } catch {
      // bloque malformado: seguir con la siguiente `{`
      continue
    }
  }
  return null
}

/**
 * Parsea `orca status --json` → OrcaStatus.
 *
 * ESTRUCTURA REAL (verificado en el binario): el JSON es limpio, con la
 * info anidada, NO un campo plano en la raíz:
 *
 *   { "ok": true, "result": { "runtime": { "state": "ready",
 *     "reachable": true }, "app": { "running": true } } }
 *
 * Orca se considera LISTO cuando `result.runtime.reachable === true`
 * (opcionalmente además `result.runtime.state === 'ready'`). Si el campo
 * no se encuentra, devuelve false (nunca true por sorpresa).
 */
export function parseOrcaStatus(stdout: string): OrcaStatus {
  const block = extractJsonBlock(stdout)
  if (block && typeof block === 'object') {
    const b = block as Record<string, unknown>
    const result = (b.result ?? {}) as Record<string, unknown>
    const runtime = (result.runtime ?? {}) as Record<string, unknown>
    const app = (result.app ?? {}) as Record<string, unknown>
    return {
      runtimeReachable: runtime.reachable === true,
      runtimeState: typeof runtime.state === 'string' ? runtime.state : undefined,
      appRunning: typeof app.running === 'boolean' ? app.running : undefined,
    }
  }
  return { runtimeReachable: false }
}

/** Parsea worktree create --json → OrcaWorktreeResult. */
export function parseOrcaWorktree(stdout: string): OrcaWorktreeResult {
  const block = extractJsonBlock(stdout)
  if (block && typeof block === 'object') {
    const b = block as Record<string, unknown>
    if (b.ok === true) {
      const wt = (b.worktree ?? {}) as Record<string, unknown>
      return {
        ok: true,
        handle: (b.handle as string) ?? (wt.handle as string) ?? (b.worktreeHandle as string),
        agentTerminalHandle: (b.agentTerminalHandle as string) ?? (wt.agentTerminalHandle as string),
        worktreeId: (b.worktreeId as string) ?? (wt.id as string) ?? (b.id as string),
      }
    }
    // ok:false (o ausente) con error. El mensaje puede venir en varias
    // rutas/formatos; normalizamos a texto sin crashear.
    const result = (b.result ?? {}) as Record<string, unknown>
    const errObj = result.error
    const msgObj = (result.message as unknown) ?? (b.message as unknown) ?? (b.error as unknown)
    return {
      ok: false,
      // prioridad: error.message (objeto error de result) → message → error
      message: errorText(errObj) || errorText(msgObj) || 'Error de Orca',
    }
  }
  return { ok: false, message: 'No se pudo leer la respuesta JSON de Orca' }
}

// ── repo list / repo add (registro de carpetas) ─────────────────────────

export interface OrcaRepo {
  /** path tal como Orca lo devuelve (absoluto). */
  path?: string
  /** identificador del repo en Orca (para repo add). */
  id?: string
  repoId?: string
}

export interface OrcaRepoList {
  ok: boolean
  /** repos devueltos por `orca repo list --json`. */
  repos: OrcaRepo[]
  message?: string
}

/** Parsea `orca repo list --json` → lista de repos. Tolerante a las rutas:
 *  busca el array en `result.repos`, `repos`, o el propio bloque. */
export function parseOrcaRepoList(stdout: string): OrcaRepoList {
  const block = extractJsonBlock(stdout)
  if (!block || typeof block !== 'object') return { ok: false, repos: [] }

  const b = block as Record<string, unknown>
  const result = (b.result ?? {}) as Record<string, unknown>
  const candidates: unknown[] = [result.repos, b.repos]
  const arr = candidates.find(Array.isArray) as unknown[] | undefined

  if (!arr) {
    // lista como objeto {path: {...}} o sin array → no encontrado
    return { ok: b.ok !== false, repos: [] }
  }
  const repos = arr
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r): OrcaRepo => ({ path: asStr(r.path), id: asStr(r.id) ?? asStr(r.repoId), repoId: asStr(r.repoId) ?? asStr(r.id) }))
  return { ok: b.ok !== false, repos }
}

/** ¿La carpeta (por path) está en la lista de repos de Orca? */
export function isRepoRegistered(repos: OrcaRepo[], repoPath: string): boolean {
  const norm = repoPath.replace(/[\\/]+$/, '')
  return repos.some((r) => (r.path ?? '').replace(/[\\/]+$/, '') === norm)
}

export interface OrcaRepoAdd {
  ok: boolean
  repos: unknown
  /** repoId/carpeta registrada (para el log). */
  id?: string
  path?: string
  message?: string
}

/** Parsea `orca repo add --json` → repoId (ruta `result.repoId`,
 *  `result.id`, `result.repo.id`, o id plano). */
export function parseOrcaRepoAdd(stdout: string): OrcaRepoAdd {
  const block = extractJsonBlock(stdout)
  if (!block || typeof block !== 'object') return { ok: false, repos: block, message: 'No se pudo leer la respuesta de repo add' }

  const b = block as Record<string, unknown>
  const result = (b.result ?? {}) as Record<string, unknown>
  const repo = (result.repo ?? {}) as Record<string, unknown>
  const reply: OrcaRepoAdd = { ok: b.ok !== false, repos: block }
  reply.id = asStr(result.repoId ?? result.id ?? repo.id ?? repo.repoId)
  reply.path = asStr(result.path ?? repo.path)
  if (b.ok === false) {
    const errObj = result.error
    const msgObj = (result.message as unknown) ?? (b.message as unknown) ?? (b.error as unknown)
    reply.message = errorText(errObj) || errorText(msgObj) || 'Error de Orca al registrar la carpeta'
  }
  return reply
}

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

// ── terminal list (estado en vivo de las sesiones) ──────────────────────

export interface OrcaTerminal {
  handle?: string
  id?: string
  connected?: boolean
  orphaned?: boolean
  /** timestamp (ms o ISO) de la última salida del terminal. */
  lastOutputAt?: number | string
  title?: string
  agent?: string
  state?: string
}

export interface OrcaTerminalList {
  ok: boolean
  terminals: OrcaTerminal[]
  message?: string
}

/** Parsea `orca terminal list --json` → lista de terminales. Tolerante a
 *  `result.terminals`, `terminals` o el propio bloque como array. */
export function parseOrcaTerminalList(stdout: string): OrcaTerminalList {
  const block = extractJsonBlock(stdout)
  if (!block) return { ok: false, terminals: [] }

  if (Array.isArray(block)) {
    return { ok: true, terminals: block.map(normalizeTerminal) }
  }
  const b = block as Record<string, unknown>
  const result = (b.result ?? {}) as Record<string, unknown>
  const candidates: unknown[] = [result.terminals, b.terminals, result.terminalList, b.terminalList]
  const arr = candidates.find(Array.isArray)
  if (!arr) return { ok: b.ok !== false, terminals: [] }
  return { ok: b.ok !== false, terminals: arr.map(normalizeTerminal) }
}

function normalizeTerminal(t: unknown): OrcaTerminal {
  if (!t || typeof t !== 'object') return {}
  const r = t as Record<string, unknown>
  return {
    handle: asStr(r.handle) ?? asStr(r.id),
    id: asStr(r.id) ?? asStr(r.handle),
    connected: typeof r.connected === 'boolean' ? r.connected : undefined,
    orphaned: typeof r.orphaned === 'boolean' ? r.orphaned : undefined,
    lastOutputAt: typeof r.lastOutputAt === 'number' || typeof r.lastOutputAt === 'string' ? r.lastOutputAt : undefined,
    title: asStr(r.title),
    agent: asStr(r.agent),
    state: asStr(r.state),
  }
}

// ── Estado derivado del terminal (efímero, nunca cacheado) ──────────────

/** Estado del terminal derivado AQUÍ Y AHORA (solo cierto al preguntar). */
export type OrcaTerminalStatus = 'closed' | 'dead' | 'active' | 'idle' | 'unknown'

export interface OrcaTerminalStatusInfo {
  status: OrcaTerminalStatus
  /** Etiqueta legible para la UI. */
  label: string
  /** ms desde lastOutputAt (null si no hay info de actividad). */
  lastActivityAgoMs: number | null
}

/** Umbral de "actividad reciente" (ms): dentro → Activa, fuera → Ociosa. */
export const ORCA_ACTIVITY_WINDOW_MS = 60_000

/** Interpreta un timestamp como ms epoch (acepta ISO string). */
export function toEpochMs(v: number | string | null | undefined): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Date.parse(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Deriva el estado del terminal:
 * - handle ausente en la lista → 'closed' (Sesión cerrada) — NO error.
 * - connected:false u orphaned:true → 'dead' (Muerta / desconectada).
 * - connected:true y lastOutputAt < ~60s → 'active' (Activa).
 * - connected:true y lastOutputAt antiguo → 'idle' (Ociosa).
 */
export function deriveTerminalStatus(
  terminal: OrcaTerminal | undefined,
  nowMs: number = Date.now(),
): OrcaTerminalStatusInfo {
  if (!terminal) {
    return { status: 'closed', label: 'Sesión cerrada', lastActivityAgoMs: null }
  }
  const connected = terminal.connected !== false
  const orphaned = terminal.orphaned === true
  if (!connected || orphaned) {
    return { status: 'dead', label: 'Muerta / desconectada', lastActivityAgoMs: lastAgoMs(terminal.lastOutputAt, nowMs) }
  }
  const lastEpoch = toEpochMs(terminal.lastOutputAt)
  if (lastEpoch == null) {
    return { status: 'idle', label: 'Ociosa', lastActivityAgoMs: null }
  }
  const ago = Math.max(0, nowMs - lastEpoch)
  if (ago < ORCA_ACTIVITY_WINDOW_MS) {
    return { status: 'active', label: 'Activa', lastActivityAgoMs: ago }
  }
  return { status: 'idle', label: 'Ociosa', lastActivityAgoMs: ago }
}

function lastAgoMs(lastOutputAt: number | string | undefined, now: number): number | null {
  const e = toEpochMs(lastOutputAt)
  return e == null ? null : Math.max(0, now - e)
}

/** Formatea "hace X" de un lapso en ms. */
export function fmtLastActivity(agoMs: number | null): string {
  if (agoMs == null) return '—'
  const s = Math.floor(agoMs / 1000)
  if (s < 60) return `hace ${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60)
  return `hace ${h} h`
}
