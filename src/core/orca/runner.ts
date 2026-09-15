import { execFile } from 'node:child_process'
import { expandHome } from '../../lib/paths'
import { ensureGitRepo, type GitExec } from './git'
import {
  classifyOrcaMessage,
  isRepoRegistered,
  parseOrcaRepoAdd,
  parseOrcaRepoList,
  parseOrcaStatus,
  parseOrcaWorktree,
  type OrcaStatus,
  type OrcaWorktreeResult,
} from './orca'

/**
 * Runner de Orca (modo "Orca" del Lanzar). Orquesta status → open → create.
 *
 * - `status` se consulta con `--json`; si runtimeReachable es false, se
 *   ejecuta `open` y se POLING status hasta que alcance true (timeout).
 * - `worktree create` recibe el prompt TAL CUAL (sin transformar).
 * - Orca mezcla logs por stdout Y stderr; el JSON de `--json` puede venir
 *   por cualquiera de los dos. Por eso se parsea la salida COMBINADA
 *   (stdout + stderr), nunca solo stdout: así un `runtimeReachable:true`
 *   que llegue por stderr NO dispara un `open` innecesario (lock de
 *   instancia única de Orca).
 *
 * La ejecución del binario es INYECTABLE (opts.execImpl) para poder
 * testear sin que exista el binario.
 */

export interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

export type ExecImpl = (bin: string, args: string[]) => Promise<ExecResult>

export const defaultExec: ExecImpl = (bin, args) =>
  new Promise((resolve) => {
    execFile(bin, args, { timeout: 120_000 }, (err, stdout, stderr) => {
      const code =
        err && typeof (err as { code?: unknown }).code === 'number'
          ? ((err as { code: number }).code as number)
          : 0
      resolve({ stdout: String(stdout), stderr: String(stderr), code })
    })
  })

export interface OrcaRunnerOptions {
  execParam?: ExecImpl
  sleepMs?: number
  openTimeoutMs?: number
  /** git runner inyectable (para el registro automático de carpeta). */
  git?: GitExec
}

export interface OrcaLaunchInput {
  bin: string
  repoPath: string
  worktreeName: string
  prompt: string
  /** id de agente Orca (flag --agent). Por defecto 'pi'. */
  agent?: string
}

/** Resultado de la fase preparativa (status→open→registro), compartido por
 *  todos los proveedores del lote. */
export interface OrcaPrepareOutcome {
  ok: boolean
  startedReachable: boolean
  opened: boolean
  registered: boolean
  registeredNow?: boolean
  repoId?: string
  message?: string
  kind: 'repo_not_found' | 'unknown_agent' | 'other' | 'register'
  status?: OrcaStatus
}

export interface OrcaLaunchOutcome {
  ok: boolean
  startedReachable: boolean
  opened: boolean
  /** true si la carpeta se registró (o ya estaba) como repo en Orca. */
  registered: boolean
  /** true si el registro se hizo AHORA (git init + repo add). */
  registeredNow?: boolean
  /** repoId devuelto por repo add (si aplica). */
  repoId?: string
  /** handle(s) del worktree en éxito. */
  handle?: string
  agentTerminalHandle?: string
  worktreeId?: string
  /** mensaje amable de error cuando ok=false. */
  message?: string
  /** kind de fallo (para avisos específicos). */
  kind: 'repo_not_found' | 'unknown_agent' | 'other' | 'register'
  status?: OrcaStatus
}

const ERR_OPEN_TIMEOUT = 'No se pudo abrir Orca (timeout al esperar al runtime).'
const ERR_STATUS = 'No se pudo leer el estado de Orca.'

/** Tiempo base entre polls del status (ms). */
export const ORCA_POLL_MS = 1500

/** Combina stdout+stderr para el parseo (el JSON de --json puede venir
 *  por cualquiera de los dos, entre logs). Pública para reusarla en la
 *  pestaña Escaneos. */
export function combined(r: ExecResult): string {
  return r.stdout + '\n' + r.stderr
}

/**
 * Registro automático de la carpeta del proyecto en Orca (si no lo está):
 *
 * 1. `orca repo list --json` → busca el path.
 * 2. Si NO está registrada:
 *    a. Si la carpeta no es repo git: git init local + user dummy + commit
 *       inicial (respeta el .gitignore local; pentest/ excluido).
 *    b. `orca repo add --path <carpeta> --json` → repoId.
 *
 * IDEMPOTENTE: si ya está registrada (y es repo git), no repite nada.
 *
 * @returns ok:false con kind:'register' y mensaje si no se pudo registrar.
 */
export async function ensureRepoRegistered(
  repoPath: string,
  opts: { bin: string; exec: ExecImpl; git?: GitExec },
): Promise<{ ok: boolean; registeredNow?: boolean; repoId?: string; message?: string }> {
  const bin = expandHome(opts.bin)
  const git = opts.git

  // 1) Ya registrado?
  const list = await opts.exec(bin, ['repo', 'list', '--json'])
  if (isRepoRegistered(parseOrcaRepoList(combined(list)).repos, repoPath)) {
    return { ok: true, registeredNow: false }
  }

  // 2a) git init local si falta (idempotente: si ya es repo, no repite)
  try {
    await ensureGitRepo(repoPath, git ? { git } : {})
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'No se pudo preparar el repo git local' }
  }

  // 2b) repo add
  const added = await opts.exec(bin, ['repo', 'add', '--path', repoPath, '--json'])
  const parsed = parseOrcaRepoAdd(combined(added))
  if (!parsed.ok) {
    return { ok: false, message: parsed.message ?? 'No se pudo registrar la carpeta en Orca' }
  }
  return { ok: true, registeredNow: true, repoId: parsed.id }
}

/**
 * Fase preparativa compartida: status → (open si falta) → registrar la
 * carpeta en Orca. Se ejecuta UNA vez por lote, no por proveedor.
 */
export async function prepareOrcaRun(
  input: Pick<OrcaLaunchInput, 'bin' | 'repoPath'>,
  opts: OrcaRunnerOptions & { exec?: ExecImpl } = {},
): Promise<OrcaPrepareOutcome> {
  const exec = opts.exec ?? defaultExec
  const bin = expandHome(input.bin)

  const first = await exec(bin, ['status', '--json'])
  const status = parseOrcaStatus(combined(first))
  let opened = false
  const openTimeout = opts.openTimeoutMs ?? 60_000
  const sleep = opts.sleepMs ?? ORCA_POLL_MS

  if (!status.runtimeReachable) {
    await exec(bin, ['open'])
    opened = true
    const deadline = Date.now() + openTimeout
    let reachable = false
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, sleep))
      const s = parseOrcaStatus(combined(await exec(bin, ['status', '--json'])))
      if (s.runtimeReachable) {
        reachable = true
        break
      }
    }
    if (!reachable) {
      return {
        ok: false, startedReachable: false, opened, registered: false, kind: 'other', message: ERR_OPEN_TIMEOUT, status,
      }
    }
  }

  const reg = await ensureRepoRegistered(input.repoPath, { bin, exec, git: opts.git })
  if (!reg.ok) {
    return {
      ok: false, startedReachable: status.runtimeReachable, opened, registered: false, kind: 'register',
      message: reg.message ?? 'No se pudo registrar la carpeta en Orca', status,
    }
  }
  return {
    ok: true, startedReachable: status.runtimeReachable, opened, registered: true,
    registeredNow: reg.registeredNow, repoId: reg.repoId, kind: 'other', status,
  }
}

/** Resultado de crear UN worktree (por proveedor). */
export interface OrcaCreateOutcome {
  ok: boolean
  handle?: string
  agentTerminalHandle?: string
  worktreeId?: string
  message?: string
  /** kind del fallo (unknown_agent si el id no es válido en Orca). */
  kind: 'repo_not_found' | 'unknown_agent' | 'other'
}

// Hardcoded del flag prometido: agent por defecto cuando no se pasa.
const FALLBACK_AGENT = 'pi'

/** Crea un worktree con el proveedor dado (flag --agent): UNA llamada. */
export async function createOrcaWorktreeRun(
  input: Pick<OrcaLaunchInput, 'bin' | 'repoPath' | 'worktreeName' | 'prompt'> & { agent?: string },
  exec: ExecImpl,
): Promise<OrcaCreateOutcome> {
  const bin = expandHome(input.bin)
  const agent = input.agent ?? FALLBACK_AGENT
  const create = await exec(bin, [
    'worktree',
    'create',
    `--repo`, `path:${input.repoPath}`,
    '--name', input.worktreeName,
    '--agent', agent,
    '--prompt', input.prompt,
    '--json',
  ])
  const res: OrcaWorktreeResult = parseOrcaWorktree(combined(create))
  if (res.ok) {
    return { ok: true, handle: res.handle, agentTerminalHandle: res.agentTerminalHandle, worktreeId: res.worktreeId, kind: 'other' }
  }
  return { ok: false, message: res.message, kind: classifyOrcaMessage(res.message) }
}

/**
 * Orquesta el lanzamiento (un solo proveedor): garantiza runtime alcanzable,
 * registra la carpeta y crea el worktree. No lanza excepciones internas.
 */
export async function runOrcaLaunch(input: OrcaLaunchInput, opts: OrcaRunnerOptions = {}): Promise<OrcaLaunchOutcome> {
  const exec = opts.execParam ?? defaultExec
  const prep = await prepareOrcaRun({ bin: input.bin, repoPath: input.repoPath }, { ...opts, exec })
  if (!prep.ok) {
    return { ok: false, startedReachable: prep.startedReachable, opened: prep.opened, registered: false, kind: prep.kind, message: prep.message, status: prep.status }
  }

  const created = await createOrcaWorktreeRun(
    { bin: input.bin, repoPath: input.repoPath, worktreeName: input.worktreeName, prompt: input.prompt, agent: input.agent },
    exec,
  )
  if (!created.ok) {
    return {
      ok: false, startedReachable: prep.startedReachable, opened: prep.opened, registered: true, kind: created.kind,
      message: created.message, status: prep.status,
    }
  }
  return {
    ok: true, startedReachable: prep.startedReachable, opened: prep.opened, registered: true,
    registeredNow: prep.registeredNow, repoId: prep.repoId, status: prep.status,
    handle: created.handle, agentTerminalHandle: created.agentTerminalHandle, worktreeId: created.worktreeId,
    kind: 'other',
  }
}