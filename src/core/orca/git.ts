/**
 * Git LOCAL del proyecto (registro automático en Orca).
 *
 * Orca solo registra carpetas que son un repo git. Para que la carpeta del
 * proyecto sea registrable hacemos de ella un repo git LOCAL (nunca push,
 * sin remote). El .git local es independiente del repo de la plataforma
 * (que ya ignora reportes/<proyecto>/ vía su .gitignore).
 *
 * El commit inicial respeta el .gitignore LOCAL del proyecto: antes de
 * `git add -A` aseguramos que `pentest/` está en su .gitignore (no se
 * comitean credenciales aunque info.md esté ahí).
 *
 * Todo es IDEMPOTENTE: si ya es repo git, no se repite nada.
 *
 * El runner de git es INYECTABLE (misma forma que el de Orca) para testear
 * sin crear git de verdad.
 */

export interface GitExecResult {
  stdout: string
  stderr: string
  code: number
}

export type GitExec = (args: string[], cwd?: string) => Promise<GitExecResult>

export interface GitEnsureOptions {
  /** git runner (default: execFile real). */
  git?: GitExec
  /** nombre/email dummy locales (se aplican SOLO si git no tiene config). */
  defaultUserName?: string
  defaultUserEmail?: string
}

const DEFAULT_NAME = 'reporter'
const DEFAULT_EMAIL = 'reporter@localhost'

/** ¿La carpeta ya es un repo git? (git rev-parse --git-dir ok) */
export async function isGitRepo(dir: string, git: GitExec): Promise<boolean> {
  try {
    const r = await git(['rev-parse', '--is-inside-work-tree'], dir)
    return r.code === 0 && /^true/i.test(r.stdout.trim())
  } catch {
    return false
  }
}

/** ¿git tiene user.name/email configurados (local o global)? */
async function hasUserConfig(git: GitExec, cwd?: string): Promise<boolean> {
  const name = await git(['config', '--get', 'user.name'], cwd)
  const email = await git(['config', '--get', 'user.email'], cwd)
  return name.code === 0 && email.code === 0 && name.stdout.trim() !== '' && email.stdout.trim() !== ''
}

/** Asegura que pentest/ está en el .gitignore local del proyecto (lo añade
 *  si falta; respeta el existente). Sin fs directo: se hace con git? No —
 *  se hace con la API de ficheros… estamos en server, así que usamos fs. */
async function appendGitIgnore(pentestGitignorePath: string) {
  const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import('node:fs')
  let content = ''
  try {
    if (existsSync(pentestGitignorePath)) content = readFileSync(pentestGitignorePath, 'utf8')
  } catch {
    content = ''
  }
  const lines = content.split('\n').map((l) => l.trim())
  const hasPentest = lines.some((l) => l === 'pentest/' || l === '**/pentest/' || l === '/pentest/')
  if (!hasPentest) {
    const add = (content === '' ? '' : content.endsWith('\n') ? '' : '\n') + 'pentest/\n'
    try {
      // el directorio del proyecto puede no existir en discos de test; crearlo
      const { dirname } = await import('node:path')
      mkdirSync(dirname(pentestGitignorePath), { recursive: true })
      writeFileSync(pentestGitignorePath, content + add)
    } catch {
      // best-effort: si no se puede escribir el .gitignore aquí, no romper
      // el flujo (los tests inyectan rutas que no existen en disco).
    }
  }
}

/**
 * Garantiza que la carpeta es un repo git local con un commit inicial
 * (HEAD válido). IDEMPOTENTE: si ya es repo git, no hace nada.
 *
 * @returns true si se inicializó algo; false si ya era repo git.
 */
export async function ensureGitRepo(
  dir: string,
  options: GitEnsureOptions = {},
): Promise<{ initialized: boolean }> {
  const git = options.git ?? defaultGitExec()
  if (await isGitRepo(dir, git)) return { initialized: false }

  // git init real puede fallar (p. ej. .git bloqueado): propagar la causa.
  const init = await git(['init', '-b', 'main'], dir)
  if (init.code !== 0) {
    throw new Error(`git init falló: ${init.stderr.trim() || init.stdout.trim() || 'código ' + init.code}`)
  }
  if (!(await hasUserConfig(git, dir))) {
    await git(['config', 'user.name', options.defaultUserName ?? DEFAULT_NAME], dir)
    await git(['config', 'user.email', options.defaultUserEmail ?? DEFAULT_EMAIL], dir)
  }

  // Respetar el .gitignore local: pentest/ nunca se comitea (credenciales)
  const { join } = await import('node:path')
  await appendGitIgnore(join(dir, '.gitignore'))

  const add = await git(['add', '-A'], dir)
  if (add.code !== 0) {
    throw new Error(`git add falló: ${add.stderr.trim() || add.stdout.trim() || 'código ' + add.code}`)
  }
  const commit = await git(['commit', '-m', 'init', '--allow-empty', '--no-verify'], dir)
  if (commit.code !== 0) {
    throw new Error(`git commit falló: ${commit.stderr.trim() || commit.stdout.trim() || 'código ' + commit.code}`)
  }
  return { initialized: true }
}

/** Runner real de git (execFile sobre binario `git`). */
function defaultGitExec(): GitExec {
  const { execFile } = require('node:child_process') as typeof import('node:child_process')
  return (args, cwd) =>
    new Promise((resolve) => {
      execFile('git', args, { timeout: 60_000, cwd }, (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0
        resolve({ stdout: String(stdout), stderr: String(stderr), code })
      })
    })
}