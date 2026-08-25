import { programParser, shortProgramPageParser, type Program, type ShortProgram } from './types'
import { userReportPageParser, type UserReport, type MyReportsResult } from './reports'
import { assertTokenValid, type YwhToken } from './token'

/**
 * Cliente de la API de YesWeHack (paso 9.4).
 *
 * Contrato verificado en 9.1 (docs/ywh-api.md):
 * - GET /programs?page=N (page desde 1; paginación en el body)
 * - GET /programs/{slug}
 * - Autorización Bearer; sin token → solo públicos (degradación)
 *
 * Expiración (9.3): ANTES de cada llamada, assertTokenValid (local, sin red).
 * Errores tipados (YwhApiError.kind): auth (401), not_found (404),
 * rate_limit (429), server (5xx), timeout, network, bad_json, validation.
 * Pacing entre páginas configurable (por defecto 250 ms) para no comer el
 * rate limit de un tirón. Cero escrituras: cliente puro.
 */

export type YwhErrorKind =
  | 'auth'
  | 'not_found'
  | 'rate_limit'
  | 'server'
  | 'timeout'
  | 'network'
  | 'bad_json'
  | 'validation'

export class YwhApiError extends Error {
  constructor(
    public kind: YwhErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message)
    this.name = 'YwhApiError'
  }
}

export interface YwhClientOptions {
  baseUrl?: string
  timeoutMs?: number
  /** Espera entre páginas de fetchAllPrograms. */
  pacingMs?: number
  /** Para tests. */
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
  nowMs?: () => number
}

/** Forma mínima de parser Zod (evita importar z en la firma pública). */
interface ZodTypeLike<T> {
  safeParse(v: unknown): { success: boolean; data?: T; error?: { message: string } }
}

export interface FetchStats {
  pages: number
  items: number
  privateItems: number
  elapsedMs: number
}

export class YwhClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly pacingMs: number
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly nowMs: () => number

  constructor(
    private readonly token: YwhToken | null,
    options: YwhClientOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? 'https://api.yeswehack.com'
    this.timeoutMs = options.timeoutMs ?? 25_000
    this.pacingMs = options.pacingMs ?? 250
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep = options.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.nowMs = options.nowMs ?? Date.now
  }

  /** GET con timeout, token si lo hay y parseo tolerante. Devuelve parseado + crudo. */
  private async getWithRaw<T>(path: string, parser: ZodTypeLike<T>): Promise<{ data: T; json: unknown }> {
    // 9.3: caducidad detectada ANTES de gastar la llamada
    if (this.token) assertTokenValid(this.token.jwt, this.nowMs())

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: this.token ? { authorization: `Bearer ${this.token.jwt}` } : {},
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof Error && err.name === 'AbortError') {
        throw new YwhApiError('timeout', `Sin respuesta en ${this.timeoutMs} ms (${path})`)
      }
      throw new YwhApiError('network', `Error de red (${path}): ${(err as Error).message}`)
    }
    clearTimeout(timer)

    if (res.status === 401) {
      throw new YwhApiError('auth', 'JWT inválido o caducado (401) — pega uno nuevo en Ajustes', 401)
    }
    if (res.status === 404) {
      throw new YwhApiError('not_found', `No existe: ${path}`, 404)
    }
    if (res.status === 429) {
      throw new YwhApiError('rate_limit', 'Rate limit de YesWeHack (429)', 429)
    }
    if (res.status >= 500) {
      throw new YwhApiError('server', `Error del servidor de YesWeHack (HTTP ${res.status})`, res.status)
    }
    if (!res.ok) {
      throw new YwhApiError('server', `HTTP ${res.status} inesperado (${path})`, res.status)
    }

    let json: unknown
    try {
      json = await res.json()
    } catch {
      throw new YwhApiError('bad_json', `La respuesta de ${path} no es JSON válido`)
    }

    const parsed = parser.safeParse(json)
    if (!parsed.success) {
      throw new YwhApiError('validation', `Respuesta de ${path} no válida: ${parsed.error?.message?.slice(0, 200)}`)
    }
    return { data: parsed.data as T, json }
  }

  private async get<T>(path: string, parser: ZodTypeLike<T>): Promise<T> {
    return (await this.getWithRaw(path, parser)).data
  }

  /** Una página de la lista (page desde 1). */
  async listProgramsPage(page = 1): Promise<{ items: ShortProgram[]; nbPages: number; nbResults: number }> {
    const data = await this.get(`/programs?page=${page}`, shortProgramPageParser)
    return {
      items: data.items,
      nbPages: data.pagination.nb_pages,
      nbResults: data.pagination.nb_results,
    }
  }

  /**
   * TODAS las páginas (criterio 9.4: "paginación completa"). Devuelve
   * items + estadísticas del recorrido (páginas, privados, duración).
   */
  async fetchAllPrograms(onPage?: (page: number, of: number) => void): Promise<{ items: ShortProgram[]; stats: FetchStats }> {
    const start = this.nowMs()
    const items: ShortProgram[] = []
    let page = 1
    let nbPages = 1

    do {
      const data = await this.listProgramsPage(page)
      nbPages = data.nbPages
      items.push(...data.items)
      onPage?.(page, nbPages)
      if (page < nbPages) await this.sleep(this.pacingMs) // pacing entre páginas
      page++
    } while (page <= nbPages)

    return {
      items,
      stats: {
        pages: page - 1,
        items: items.length,
        privateItems: items.filter((i) => !i.public).length,
        elapsedMs: this.nowMs() - start,
      },
    }
  }

  /** Detalle de un programa por slug. */
  async getProgram(slug: string): Promise<Program> {
    return this.get(`/programs/${encodeURIComponent(slug)}`, programParser)
  }

  /** Detalle parseado + respuesta CRUD (para programa.json, 9.6 ampliado). */
  async getProgramWithRaw(slug: string): Promise<{ program: Program; raw: unknown }> {
    const { data, json } = await this.getWithRaw(`/programs/${encodeURIComponent(slug)}`, programParser)
    return { program: data, raw: json }
  }

  /**
   * RECORRE todas las páginas de `GET /user/reports` (mis reportes).
   * Requiere token: sin token no hay reportes propios.
   */
  async fetchAllMyReports(
    onPage?: (page: number, of: number) => void,
  ): Promise<MyReportsResult> {
    if (!this.token) throw new YwhApiError('auth', 'No hay token: no se pueden listar tus reportes', 401)
    const start = this.nowMs()
    const items: UserReport[] = []
    let page = 1
    let nbPages = 1

    do {
      const data = await this.get(`/user/reports?page=${page}`, userReportPageParser)
      nbPages = data.pagination.nb_pages
      items.push(...data.items)
      onPage?.(page, nbPages)
      if (page < nbPages) await this.sleep(this.pacingMs)
      page++
    } while (page <= nbPages)

    return { items, stats: { pages: page - 1, items: items.length, elapsedMs: this.nowMs() - start } }
  }
}
