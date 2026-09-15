import {
  programDetailParser,
  programsPageParser,
  type ProgramDetail,
  type ProgramOverview,
} from './types'

/**
 * Cliente de la API Researcher de Intigriti (paso 2 del plan
 * multiplataforma). Contrato verificado en vivo (docs/intigriti-api.md):
 *
 * - Base: https://api.intigriti.com/external/researcher
 * - Auth: Bearer PAT de larga duración. SIN endpoints públicos: sin token
 *   todo es 401, NO hay degradación como en YWH.
 * - Paginación por OFFSET: `limit` (0..500) + `offset`; respuesta
 *   `{maxCount, records}`; `offset` fuera de rango → 200 con `records: []`.
 *   Condición 3 del plan: iterar hasta agotar `maxCount` con el mismo pacing
 *   que YWH y TOPE DE SEGURIDAD de iteraciones (maxCount inconsistente).
 * - Errores tipados (IntigritiApiError.kind), mismos kinds que YwhApiError.
 * - Cero escrituras: cliente puro. Sin expiración local de token (PAT larga
 *   duración; la gestión de tokens llega en el paso 3).
 */

export type IntigritiErrorKind =
  | 'auth'
  | 'not_found'
  | 'rate_limit'
  | 'server'
  | 'timeout'
  | 'network'
  | 'bad_json'
  | 'validation'

export class IntigritiApiError extends Error {
  constructor(
    public kind: IntigritiErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message)
    this.name = 'IntigritiApiError'
  }
}

export interface IntigritiClientOptions {
  baseUrl?: string
  timeoutMs?: number
  /** Espera entre páginas de fetchAllPrograms (mismo pacing que YWH). */
  pacingMs?: number
  /** Tamaño de página (el spec admite hasta 500). */
  limit?: number
  /** Tope de seguridad de iteraciones por si maxCount es inconsistente. */
  maxIterations?: number
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
  elapsedMs: number
}

const MAX_LIMIT = 500

export class IntigritiClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly pacingMs: number
  private readonly limit: number
  private readonly maxIterations: number
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly nowMs: () => number

  constructor(
    /** PAT de larga duración; null → los endpoints de programas fallan con auth. */
    private readonly token: string | null,
    options: IntigritiClientOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? 'https://api.intigriti.com/external/researcher'
    this.timeoutMs = options.timeoutMs ?? 25_000
    this.pacingMs = options.pacingMs ?? 250
    this.limit = Math.min(Math.max(options.limit ?? 100, 1), MAX_LIMIT)
    this.maxIterations = Math.max(options.maxIterations ?? 500, 1)
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep = options.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.nowMs = options.nowMs ?? Date.now
  }

  /** GET con timeout, token y parseo tolerante. Devuelve parseado + crudo. */
  private async getWithRaw<T>(path: string, parser: ZodTypeLike<T>): Promise<{ data: T; json: unknown }> {
    if (!this.token) {
      throw new IntigritiApiError(
        'auth',
        'Sin token: la API de Intigriti no tiene endpoints públicos — pega tu PAT en Ajustes',
        401,
      )
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${this.token}` },
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof Error && err.name === 'AbortError') {
        throw new IntigritiApiError('timeout', `Sin respuesta en ${this.timeoutMs} ms (${path})`)
      }
      throw new IntigritiApiError('network', `Error de red (${path}): ${(err as Error).message}`)
    }
    clearTimeout(timer)

    if (res.status === 401) {
      throw new IntigritiApiError('auth', 'PAT inválido o sin permisos (401) — revisa tu token en Ajustes', 401)
    }
    if (res.status === 404) {
      throw new IntigritiApiError('not_found', `No existe: ${path}`, 404)
    }
    if (res.status === 429) {
      throw new IntigritiApiError('rate_limit', 'Rate limit de Intigriti (429)', 429)
    }
    if (res.status >= 500) {
      throw new IntigritiApiError('server', `Error del servidor de Intigriti (HTTP ${res.status})`, res.status)
    }
    if (!res.ok) {
      throw new IntigritiApiError('server', `HTTP ${res.status} inesperado (${path})`, res.status)
    }

    let json: unknown
    try {
      json = await res.json()
    } catch {
      throw new IntigritiApiError('bad_json', `La respuesta de ${path} no es JSON válido`)
    }

    const parsed = parser.safeParse(json)
    if (!parsed.success) {
      throw new IntigritiApiError('validation', `Respuesta de ${path} no válida: ${parsed.error?.message?.slice(0, 200)}`)
    }
    return { data: parsed.data as T, json }
  }

  private async get<T>(path: string, parser: ZodTypeLike<T>): Promise<T> {
    return (await this.getWithRaw(path, parser)).data
  }

  /** Una página de la lista (paginación por offset). */
  async listProgramsPage(offset = 0): Promise<{ records: ProgramOverview[]; maxCount: number }> {
    const data = await this.get(`/v1/programs?limit=${this.limit}&offset=${offset}`, programsPageParser)
    return { records: data.records, maxCount: data.maxCount }
  }

  /**
   * TODAS las páginas (condición 3 del plan): itera por offset hasta reunir
   * `maxCount` records, con pacing y tope de iteraciones por si la API
   * devuelve un maxCount inconsistente (no entrar en bucle).
   */
  async fetchAllPrograms(onPage?: (page: number, of: number) => void): Promise<{ items: ProgramOverview[]; stats: FetchStats }> {
    const start = this.nowMs()
    const items: ProgramOverview[] = []
    let maxCount = 0
    let pages = 0

    do {
      const data = await this.listProgramsPage(items.length)
      maxCount = data.maxCount
      items.push(...data.records)
      pages++
      onPage?.(pages, Math.max(Math.ceil(maxCount / this.limit), 1))
      // Sin progreso (records vacío) o maxCount alcanzado → parar.
      if (!(items.length < maxCount && data.records.length > 0)) break
      await this.sleep(this.pacingMs) // pacing entre páginas
    } while (pages < this.maxIterations)

    return {
      items,
      stats: {
        pages,
        items: items.length,
        elapsedMs: this.nowMs() - start,
      },
    }
  }

  /** Detalle de un programa por programId (uuid). */
  async getProgram(programId: string): Promise<ProgramDetail> {
    return this.get(`/v1/programs/${encodeURIComponent(programId)}`, programDetailParser)
  }

  /** Detalle parseado + respuesta CRUD (para programa.json). */
  async getProgramWithRaw(programId: string): Promise<{ program: ProgramDetail; raw: unknown }> {
    const { data, json } = await this.getWithRaw(`/v1/programs/${encodeURIComponent(programId)}`, programDetailParser)
    return { program: data, raw: json }
  }
}
