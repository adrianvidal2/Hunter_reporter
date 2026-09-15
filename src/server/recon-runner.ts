import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from '@/lib/env'
import { resolveSafeAllowMissing } from '@/core/fs/paths'
import { listProjects } from '@/core/fs/tree'
import {
  assessAutomatedTooling,
  buildToolCommands,
  fuzzTargetWarning,
  getTool,
  needsGate,
  resolveTargets,
  type ProgramRulesInput,
  type TargetRejection,
  type ToolCommand,
  type ToolingVerdict,
  type ToolId,
  buildUrlToolCommand,
  DEFAULT_WORDLIST,
} from '@/core/recon/tools'
import { loadReconSettings, resolveBinPath } from '@/core/recon/settings'

/**
 * Runner de procesos del módulo recon. Puntos de revisión del diseño:
 *
 * - spawn(bin, args, { shell: false, detached: true }): SIN shell no hay
 *   inyección de comandos — los argumentos son array construido por las
 *   recetas del núcleo, jamás un string del cliente. detached crea GRUPO DE
 *   PROCESO propio (pgid = pid del hijo), lo que permite matar al binario Y
 *   a sus hijos con process.kill(-pid).
 *   NOTA: spawn y no execFile porque en Node 22 execFile NO aplica detached
 *   (verificado: el hijo queda en nuestro pgid y kill(-pid) da ESRCH);
 *   spawn es la primitiva sobre la que execFile está construido.
 * - Escalado SIGTERM → (gracia de 10 s) → SIGKILL contra el GRUPO, con
 *   fallback al proceso directo si el grupo ya no existe.
 * - Huérfanos al reiniciar el servidor: recoverOrphans() lee los run.json
 *   con status 'running' de la sesión anterior; pid VIVO → 'orphaned' (la
 *   UI ofrecerá matarlo EXPLÍCITAMENTE con killOrphan: nada se mata solo);
 *   pid muerto → 'interrupted'.
 * - Salida: stdout+stderr se appenden a output.log y se difunden por el
 *   canal de suscripción; el estado vive en el servidor (run.json +
 *   registro), así que cerrar la pestaña no afecta al proceso.
 */

const GRACE_MS = 10_000 // SIGTERM → SIGKILL
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 24 * 60 * 60_000
const DEFAULT_TIMEOUT_MS = 30 * 60_000

export type ReconRunStatus =
  | 'running'
  | 'done'
  | 'timeout'
  | 'cancelled'
  | 'error'
  | 'orphaned'
  | 'interrupted'

export interface ReconRunRecord {
  runId: string
  project: string
  toolId: string
  binPath: string
  /** Traza del binario concreto ejecutado (tamaño y mtime, no solo la ruta). */
  binary: { size: number; mtimeMs: number }
  /** Comandos exactos (arrays), con su resultado individual. */
  commands: { args: string[]; exitCode?: number | null; signal?: string | null }[]
  targets: string[]
  /** Rechazados por resolveTargets, con motivo (out_of_scope | invalid). */
  rejected: TargetRejection[]
  uaInjected: boolean
  warnings: string[]
  rules: ToolingVerdict
  confirmedByUser: boolean
  status: ReconRunStatus
  startedAt: string
  finishedAt?: string
  pid?: number | null
  /** Nombre del directorio de salida bajo pentest/recon/<tool>/. */
  dirName: string
  /** starttime de /proc/<pid>/stat (Linux): contrasta reciclaje de PID. */
  procStartTime?: number | null
  timeoutMs: number
  exitCode?: number | null
  signal?: string | null
  error?: string
}

export interface ReconEvent {
  type: 'recon-output' | 'recon-status'
  runId: string
  status?: ReconRunStatus
  chunk?: string
}

export interface StartReconInput {
  project: string
  toolId: string
  /** Targets pedidos por la UI (el runner los interseca contra `scope`). */
  targets: string[]
  /** Scope in-scope ACTUAL, leído de pentest/programa.json por el llamador. */
  scope: string[]
  userAgent?: string
  rules?: ProgramRulesInput
  /** true SOLO cuando el usuario pasó el gate explícitamente en la UI. */
  confirmed?: boolean
  timeoutMs?: number
  wordlist?: string
}

export type StartReconResult =
  | { ok: true; runId: string; outputDir: string; warnings: string[] }
  | {
      ok: false
      error: string
      needsConfirmation?: boolean
      verdict?: ToolingVerdict
      rejected?: TargetRejection[]
    }

interface RunState {
  record: ReconRunRecord
  outputDirAbs: string
  proc: ChildProcess | null
  status: ReconRunStatus
  timeoutTimer?: NodeJS.Timeout
  graceTimer?: NodeJS.Timeout
}

export interface ReconRunnerOptions {
  root?: string
  /** Inyectable para tests. */
  spawnImpl?: typeof spawn
  nowMs?: () => number
  /** Gracia del escalado SIGTERM→SIGKILL (tests: corta). */
  killGraceMs?: number
}

export class ReconRunner {
  private readonly root: string
  private readonly spawnImpl: typeof spawn
  private readonly nowMs: () => number
  private readonly killGraceMs: number
  private readonly runs = new Map<string, RunState>()
  private readonly subscribers = new Set<(e: ReconEvent) => void>()

  constructor(options: ReconRunnerOptions = {}) {
    this.root = options.root ?? getEnv().REPORTS_ROOT
    this.spawnImpl = options.spawnImpl ?? spawn
    this.nowMs = options.nowMs ?? Date.now
    this.killGraceMs = options.killGraceMs ?? GRACE_MS
  }

  subscribe(cb: (e: ReconEvent) => void): () => void {
    this.subscribers.add(cb)
    return () => this.subscribers.delete(cb)
  }

  private broadcast(e: ReconEvent): void {
    for (const cb of this.subscribers) cb(e)
  }

  /** El estado vivo es el del RunState; el record es su serialización. */
  getRun(runId: string): ReconRunRecord | null {
    const run = this.runs.get(runId)
    if (!run) return null
    return { ...run.record, status: run.status }
  }

  /** Runs vivos en este proceso (los históricos se leen de run.json). */
  listActive(): ReconRunRecord[] {
    return [...this.runs.values()].filter((r) => r.status === 'running').map((r) => r.record)
  }

  /** Cancela: SIGTERM al grupo, gracia, SIGKILL. Estado 'cancelled'. */
  cancel(runId: string): boolean {
    const run = this.runs.get(runId)
    if (!run || run.status !== 'running') return false
    run.status = 'cancelled'
    run.record.status = 'cancelled'
    this.terminateGroup(run)
    return true
  }

  /** SIGTERM al GRUPO (pid negativo = grupo en kill(2)); fallback directo. */
  private terminateGroup(run: RunState): void {
    const pid = run.proc?.pid
    if (!pid) return
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      try {
        run.proc?.kill('SIGTERM')
      } catch {
        /* ya muerto */
      }
    }
    run.graceTimer = setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        try {
          run.proc?.kill('SIGKILL')
        } catch {
          /* ya muerto */
        }
      }
    }, this.killGraceMs)
    run.graceTimer.unref?.()
  }

  private persist(run: RunState): void {
    try {
      const rel = this.relFromAbs(run.outputDirAbs) + '/run.json'
      writeFileSync(path.join(this.root, rel), JSON.stringify(run.record, null, 2) + '\n')
    } catch (err) {
      console.error('recon: no se pudo escribir run.json:', err)
    }
  }

  private relFromAbs(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join('/')
  }

  private finish(run: RunState, exitCode: number | null, signal: string | null): void {
    clearTimeout(run.timeoutTimer)
    clearTimeout(run.graceTimer)
    if (run.status === 'running') run.status = exitCode === 0 ? 'done' : 'error'
    run.record.status = run.status
    run.record.finishedAt = new Date().toISOString()
    run.record.exitCode = exitCode
    run.record.signal = signal
    this.persist(run)
    this.broadcast({ type: 'recon-status', runId: run.record.runId, status: run.status })
  }

  /** Lanza la herramienta. Devuelve tras el primer spawn (no bloquea). */
  start(input: StartReconInput): StartReconResult {
    const tool = getTool(input.toolId)
    if (!tool) return { ok: false, error: `Herramienta fuera de la lista blanca: ${input.toolId}` }
    if (tool.scopeMode === 'url') {
      return { ok: false, error: `${tool.label} se lanza desde la sección de URL concreta` }
    }
    if (!listProjects(this.root).includes(input.project)) {
      return { ok: false, error: `No existe el proyecto: ${input.project}` }
    }

    // 1) Intersección servidor-side contra el scope del programa.json
    const { accepted, rejected } = resolveTargets(tool.targetKind, input.targets, input.scope)
    if (accepted.length === 0) {
      return { ok: false, error: 'Ningún target válido tras la intersección con el scope', rejected }
    }

    // 2) Gate de reglas (tres estados): active/exploitation → salvo 'explicitly_allowed'
    const verdict = assessAutomatedTooling(input.rules ?? {})
    if (needsGate(input.toolId, verdict) && !input.confirmed) {
      return {
        ok: false,
        needsConfirmation: true,
        verdict,
        rejected,
        error: 'Las reglas del programa no autorizan explícitamente la automatización: confirma para lanzar',
      }
    }

    // 3) Binario: ruta por herramienta en Ajustes, verificada (existe + ejecutable)
    const binPath = resolveBinPath(input.toolId as ToolId)
    try {
      statSync(binPath)
      accessSync(binPath, 1) // X_OK
    } catch {
      return { ok: false, error: `El binario de ${tool.label} no existe o no es ejecutable: ${binPath}` }
    }
    const binStat = statSync(binPath)

    // 4) Timeout y directorio de salida <proyecto>/pentest/recon/<tool>/<fecha>/
    const settings = loadReconSettings()
    const configuredMs =
      settings.timeoutMinutes !== undefined ? settings.timeoutMinutes * 60_000 : DEFAULT_TIMEOUT_MS
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? configuredMs, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)

    const stamp = new Date(this.nowMs())
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+$/, '')
      .replace('T', '-')
    let dirName = stamp
    while (existsSync(path.join(this.root, input.project, 'pentest', 'recon', tool.id, dirName))) {
      dirName = `${stamp}-${Math.random().toString(36).slice(2, 5)}`
    }
    const outRel = `${input.project}/pentest/recon/${tool.id}/${dirName}`
    const outputDirAbs = resolveSafeAllowMissing(outRel, this.root)
    mkdirSync(outputDirAbs, { recursive: true })

    // targets.txt en el dir de salida: lo consumen las recetas por fichero
    const targetFile = path.join(outputDirAbs, 'targets.txt')
    writeFileSync(targetFile, accepted.join('\n') + '\n')

    let commands: ToolCommand[]
    try {
      commands = buildToolCommands(input.toolId, accepted, {
        userAgent: tool.supportsUserAgent ? input.userAgent : undefined,
        targetFile,
        wordlist: input.wordlist ?? settings.wordlist ?? DEFAULT_WORDLIST,
      })
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Error en la receta' }
    }

    const warnings: string[] = []
    const apexWarn = fuzzTargetWarning(input.toolId, accepted, input.scope)
    if (apexWarn) warnings.push(apexWarn)
    if (!input.userAgent && tool.supportsUserAgent) {
      warnings.push(
        'El programa declara User-Agent obligatorio pero no hay UA disponible: no se inyectó. Actualiza los datos del programa.',
      )
    }

    const runId = `${input.toolId}-${stamp}-${Math.random().toString(36).slice(2, 6)}`
    const record: ReconRunRecord = {
      runId,
      project: input.project,
      toolId: input.toolId,
      binPath,
      binary: { size: binStat.size, mtimeMs: Math.round(binStat.mtimeMs) },
      commands: commands.map((c) => ({ args: c.args })),
      targets: accepted,
      rejected,
      uaInjected: tool.supportsUserAgent && input.userAgent !== undefined,
      warnings,
      rules: verdict,
      confirmedByUser: input.confirmed ?? false,
      status: 'running',
      startedAt: new Date(this.nowMs()).toISOString(),
      pid: null,
      dirName,
      timeoutMs,
    }

    const run: RunState = { record, outputDirAbs, proc: null, status: 'running' }
    this.runs.set(runId, run)
    this.persist(run)

    // Timeout del RUN completo (no por comando): escalado con gracia
    run.timeoutTimer = setTimeout(() => {
      if (run.status !== 'running') return
      run.status = 'timeout'
      run.record.status = 'timeout'
      this.terminateGroup(run)
    }, timeoutMs)
    run.timeoutTimer.unref?.()

    // 5) Ejecución secuencial de los comandos de la receta (fuzzers: 1/target)
    const outputLog = path.join(outputDirAbs, 'output.log')
    void this.execSequence(run, commands, outputLog)

    return { ok: true, runId, outputDir: outRel, warnings }
  }

  /**
   * Lanza sqlmap/dalfox sobre UNA URL concreta (ya compuesta y validada por
   * el llamador con composeUrl): mismo gate, mismo registro, mismo dir de
   * salida que los runs de scope.
   */
  startUrlRun(input: {
    project: string
    toolId: string
    url: string
    userAgent?: string
    rules?: ProgramRulesInput
    confirmed?: boolean
    timeoutMs?: number
  }): StartReconResult {
    const tool = getTool(input.toolId)
    if (!tool || tool.scopeMode !== 'url') {
      return { ok: false, error: `${input.toolId} no es una herramienta de URL concreta` }
    }
    if (!listProjects(this.root).includes(input.project)) {
      return { ok: false, error: `No existe el proyecto: ${input.project}` }
    }

    const verdict = assessAutomatedTooling(input.rules ?? {})
    if (needsGate(input.toolId, verdict) && !input.confirmed) {
      return {
        ok: false,
        needsConfirmation: true,
        verdict,
        error: 'Las reglas del programa no autorizan explícitamente la automatización: confirma para lanzar',
      }
    }

    const binPath = resolveBinPath(input.toolId as ToolId)
    try {
      statSync(binPath)
      accessSync(binPath, 1)
    } catch {
      return { ok: false, error: `El binario de ${tool.label} no existe o no es ejecutable: ${binPath}` }
    }
    const binStat = statSync(binPath)

    let command: ToolCommand
    try {
      command = buildUrlToolCommand(input.toolId, input.url, {
        userAgent: tool.supportsUserAgent ? input.userAgent : undefined,
      })
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Error en la receta' }
    }

    const settings = loadReconSettings()
    const configuredMs =
      settings.timeoutMinutes !== undefined ? settings.timeoutMinutes * 60_000 : DEFAULT_TIMEOUT_MS
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? configuredMs, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)

    const stamp = new Date(this.nowMs())
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+$/, '')
      .replace('T', '-')
    let dirName = stamp
    while (existsSync(path.join(this.root, input.project, 'pentest', 'recon', tool.id, dirName))) {
      dirName = `${stamp}-${Math.random().toString(36).slice(2, 5)}`
    }
    const outRel = `${input.project}/pentest/recon/${tool.id}/${dirName}`
    const outputDirAbs = resolveSafeAllowMissing(outRel, this.root)
    mkdirSync(outputDirAbs, { recursive: true })

    const runId = `${input.toolId}-${stamp}-${Math.random().toString(36).slice(2, 6)}`
    const record: ReconRunRecord = {
      runId,
      project: input.project,
      toolId: input.toolId,
      binPath,
      binary: { size: binStat.size, mtimeMs: Math.round(binStat.mtimeMs) },
      commands: [{ args: command.args }],
      targets: [input.url],
      rejected: [],
      uaInjected: tool.supportsUserAgent && input.userAgent !== undefined,
      warnings: [],
      rules: verdict,
      confirmedByUser: input.confirmed ?? false,
      status: 'running',
      startedAt: new Date(this.nowMs()).toISOString(),
      pid: null,
      dirName,
      timeoutMs,
    }
    const run: RunState = { record, outputDirAbs, proc: null, status: 'running' }
    this.runs.set(runId, run)
    this.persist(run)

    run.timeoutTimer = setTimeout(() => {
      if (run.status !== 'running') return
      run.status = 'timeout'
      run.record.status = 'timeout'
      this.terminateGroup(run)
    }, timeoutMs)
    run.timeoutTimer.unref?.()

    const outputLog = path.join(outputDirAbs, 'output.log')
    appendFileSync(outputLog, `$ ${binPath} ${command.args.join(' ')}\n`)
    void this.execSequence(run, [command], outputLog)

    return { ok: true, runId, outputDir: outRel, warnings: [] }
  }

  private async execSequence(run: RunState, commands: ToolCommand[], outputLog: string): Promise<void> {
    for (let i = 0; i < commands.length; i++) {
      if (run.status !== 'running') break
      const { exitCode, signal } = await this.execOne(run, commands[i]!, outputLog, i === 0)
      run.record.commands[i]!.exitCode = exitCode
      run.record.commands[i]!.signal = signal
    }
    if (this.runs.get(run.record.runId) !== run) return // ya cerrado y borrado
    const last = run.record.commands.at(-1)
    if (run.status !== 'running') {
      // cortado entre comandos (timeout/cancelled con proc ya muerto)
      this.finish(run, last?.exitCode ?? null, last?.signal ?? null)
      return
    }
    this.finish(run, last?.exitCode ?? 0, last?.signal ?? null)
  }

  /** Un comando: spawn con shell:false y detached (grupo propio). */
  private execOne(
    run: RunState,
    command: ToolCommand,
    outputLog: string,
    first: boolean,
  ): Promise<{ exitCode: number | null; signal: string | null }> {
    return new Promise((resolve) => {
      let settled = false
      const done = (exitCode: number | null, signal: string | null) => {
        if (settled) return
        settled = true
        resolve({ exitCode, signal })
      }
      if (first) {
        appendFileSync(outputLog, `$ ${run.record.binPath} ${command.args.join(' ')}\n`)
      }
      const proc = this.spawnImpl(run.record.binPath, command.args, {
        shell: false, // SIN shell: nada que interpretar (los args son array)
        detached: true, // grupo propio: kill(-pid) mata binario e hijos
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
          HOME: process.env.HOME ?? '/tmp',
          LANG: 'C.UTF-8',
          NODE_ENV: process.env.NODE_ENV,
        } as NodeJS.ProcessEnv,
        cwd: run.outputDirAbs,
      })
      run.proc = proc
      if (proc.pid) {
        run.record.pid = proc.pid
        run.record.procStartTime = readProcStartTime(proc.pid)
        this.persist(run)
      }

      proc.stdout?.on('data', (chunk: Buffer) => this.appendOutput(run, outputLog, chunk))
      proc.stderr?.on('data', (chunk: Buffer) => this.appendOutput(run, outputLog, chunk))
      try {
        proc.stdin?.write((command.stdin ?? '') + '\n')
        proc.stdin?.end()
      } catch {
        /* herramienta sin stdin */
      }

      proc.once('error', (err) => {
        run.record.error = err.message
        this.finish(run, null, null)
        done(null, null)
      })
      proc.once('close', (code, signal) => {
        if (run.status === 'timeout' || run.status === 'cancelled') {
          // el origen del escalado ya puso el estado: cerrar y persistir
          this.finish(run, code, signal)
        }
        done(code, signal ?? null)
      })
    })
  }

  private appendOutput(run: RunState, outputLog: string, chunk: Buffer): void {
    try {
      appendFileSync(outputLog, chunk)
    } catch {
      /* problema de disco: el proceso sigue, solo perdemos el log */
    }
    this.broadcast({ type: 'recon-output', runId: run.record.runId, chunk: chunk.toString('utf8') })
  }

  // ── Huérfanos al reiniciar el servidor ─────────────────────────────────

  /**
   * Lee los run.json con status 'running' de la sesión anterior: pid VIVO →
   * 'orphaned' (la UI ofrecerá matarlo explícitamente con killOrphan; NADA
   * se mata solo); pid muerto → 'interrupted'.
   */
  recoverOrphans(): { orphaned: string[]; interrupted: string[] } {
    const orphaned: string[] = []
    const interrupted: string[] = []
    for (const project of listProjects(this.root)) {
      const reconRoot = path.join(this.root, project, 'pentest', 'recon')
      if (!existsSync(reconRoot)) continue
      for (const toolDir of readdirSync(reconRoot)) {
        const toolPath = path.join(reconRoot, toolDir)
        if (!statSync(toolPath).isDirectory()) continue
        for (const runDir of readdirSync(toolPath)) {
          const runJson = path.join(toolPath, runDir, 'run.json')
          if (!existsSync(runJson)) continue
          try {
            const record = JSON.parse(readFileSync(runJson, 'utf8')) as ReconRunRecord
            if (record.status !== 'running' || !record.pid) continue
            // pid vivo + MISMO starttime → huérfano nuestro; pid reciclado →
            // el proceso ya no es el nuestro: 'interrupted' (nunca se mata)
            const alive = pidMatches(record.pid, record.procStartTime)
            record.status = alive ? 'orphaned' : 'interrupted'
            writeFileSync(runJson, JSON.stringify(record, null, 2) + '\n')
            ;(alive ? orphaned : interrupted).push(record.runId)
          } catch {
            /* run.json corrupto: se ignora */
          }
        }
      }
    }
    return { orphaned, interrupted }
  }

  /**
   * Mata un huérfano por el pid persistido (SOLO con acción humana).
   * Antes de enviar la señal contrasta starttime: si el pid fue reciclado
   * por otro proceso, NO dispara (devuelve false).
   */
  killOrphan(runJsonAbsPath: string): boolean {
    try {
      const record = JSON.parse(readFileSync(runJsonAbsPath, 'utf8')) as ReconRunRecord
      if (!record.pid || record.status !== 'orphaned') return false
      if (!pidMatches(record.pid, record.procStartTime)) {
        // pid reciclado o ya muerto: re-clasificar y NO enviar señal
        record.status = 'interrupted'
        writeFileSync(runJsonAbsPath, JSON.stringify(record, null, 2) + '\n')
        return false
      }
      killGroup(record.pid)
      record.status = 'cancelled'
      record.finishedAt = new Date().toISOString()
      writeFileSync(runJsonAbsPath, JSON.stringify(record, null, 2) + '\n')
      return true
    } catch {
      return false
    }
  }
}

/**
 * starttime del proceso según /proc/<pid>/stat (campo 22, ticks de reloj
 * desde el boot). Es la forma fiable de contrastar reciclaje de PID: si el
 * SO reutilizó el pid, el starttime del ocupante actual es distinto.
 * Devuelve null fuera de Linux o si el proceso no existe.
 */
export function readProcStartTime(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    // comm puede contener espacios y paréntesis: todo tras el ÚLTIMO ')'
    const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    return Number(after[19]) // starttime = campo 22 global = índice 19 aquí
  } catch {
    return null // sin /proc (no-Linux) o proceso inexistente
  }
}

/**
 * ¿El pid está vivo Y es el MISMO proceso que lanzamos (mismo starttime)?
 * Sin /proc (starttime null): degrada a pid-alive solo — LIMITACIÓN
 * documentada: en no-Linux un pid reciclado daría falso positivo.
 */
function pidMatches(pid: number, procStartTime: number | null | undefined): boolean {
  if (!pidAlive(pid)) return false
  if (procStartTime == null) return true // fallback documentado (no-Linux)
  const current = readProcStartTime(pid)
  return current !== null && current === procStartTime
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0) // señal 0: no envía nada, solo comprueba vida/permisos
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM' // existe, de otro usuario
  }
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* ya muerto */
    }
  }
}

/** Singleton por root (globalThis, mismo patrón que watcher-service). */
export function getReconRunner(options: ReconRunnerOptions = {}): ReconRunner {
  const root = options.root ?? getEnv().REPORTS_ROOT
  const store = (globalThis.__reporterReconRunner ??= new Map<string, ReconRunner>())
  const existing = store.get(root)
  if (existing) return existing
  const runner = new ReconRunner(options)
  store.set(root, runner)
  return runner
}

declare global {
  // eslint-disable-next-line no-var
  var __reporterReconRunner: Map<string, ReconRunner> | undefined
}
