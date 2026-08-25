import { existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from '../../lib/env'
import { writeAtomic } from '../fs/atomic'
import { PathEscapeError, resolveSafe } from '../fs/paths'
import { trashFile } from '../fs/trash'
import { InvalidFilenameError, sanitizeFilename } from '../fs/sanitize'

/**
 * Plantillas de informe (7.1/7.4). Dos ámbitos:
 *
 * - GLOBAL:   `<root>/.config/templates/<nombre>.md`
 * - PROYECTO: `<root>/<project>/.config/templates/<nombre>.md` (prioridad)
 *
 * `.config` es carpeta oculta: ni listProjects ni listProject la enumeran
 * y el watcher la ignora en CUALQUIER posición (editar plantillas no genera
 * pendientes). Escrituras con writeAtomic; borrado → .trash, nunca unlink.
 */

export const TEMPLATES_DIR = '.config/templates'

/** El nombre de plantilla no es usable. */
export class InvalidTemplateNameError extends Error {
  constructor(name: string, reason: string) {
    super(`Nombre de plantilla inválido (${reason}): ${JSON.stringify(name)}`)
    this.name = 'InvalidTemplateNameError'
  }
}

/** Normaliza un nombre de plantilla a `algo.md` (un solo segmento). */
function normalizeName(name: string): string {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new InvalidTemplateNameError(name, 'vacío')
  }
  if (/[/\\]/.test(name) || name.includes('..')) {
    throw new InvalidTemplateNameError(name, 'separadores o ".." no permitidos')
  }
  let out: string
  try {
    out = sanitizeFilename(name)
  } catch (err) {
    if (err instanceof InvalidFilenameError) {
      throw new InvalidTemplateNameError(name, 'queda vacío tras sanitizar')
    }
    throw err
  }
  if (!out.toLowerCase().endsWith('.md')) out += '.md'
  return out
}

/** Garantiza un directorio de plantillas (idempotente). */
function ensureDir(relDir: string, root: string): string {
  const realRoot = realpathSync(root)
  const dir = path.join(realRoot, relDir)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Garantiza `<root>/.config/templates` (idempotente). Devuelve su ruta abs. */
export function ensureTemplatesDir(root: string = getEnv().REPORTS_ROOT): string {
  return ensureDir(TEMPLATES_DIR, root)
}

/** Nombres de plantilla existentes, orden natural. */
export function listTemplates(root: string = getEnv().REPORTS_ROOT): string[] {
  const realRoot = realpathSync(root)
  const dir = path.join(realRoot, TEMPLATES_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }))
}

/** Lee una plantilla. Lanza ENOENT de fs si no existe. */
export function readTemplate(
  name: string,
  root: string = getEnv().REPORTS_ROOT,
): { name: string; content: string } {
  const file = normalizeName(name)
  const abs = resolveSafe(`${TEMPLATES_DIR}/${file}`, root)
  return { name: file, content: readFileSync(abs, 'utf8') }
}

/** Crea o sobrescribe una plantilla (atómico). Con `project`, la guarda
 *  en el ámbito del proyecto; si no, en el global. */
export function saveTemplate(
  name: string,
  content: string,
  root: string = getEnv().REPORTS_ROOT,
  project?: string,
): string {
  const file = normalizeName(name)
  const dir = project ? projectTemplatesDir(project) : TEMPLATES_DIR
  ensureDir(dir, root)
  writeAtomic(`${dir}/${file}`, content, { root })
  return file
}

/**
 * Borra una plantilla moviéndola a `.trash/` (recuperable, como todo).
 * Con `project`, borra la del ámbito del proyecto.
 * @returns true si existía; false si ya no estaba.
 */
export function deleteTemplate(
  name: string,
  root: string = getEnv().REPORTS_ROOT,
  project?: string,
): boolean {
  const file = normalizeName(name)
  const dir = project ? projectTemplatesDir(project) : TEMPLATES_DIR
  try {
    trashFile(`${dir}/${file}`, root)
    return true
  } catch (err) {
    if (err instanceof PathEscapeError) throw err
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

export interface TemplateHit {
  name: string
  scope: 'project' | 'global'
  content: string
}

/** Directorio de plantillas del ámbito PROYECTO (relativo al root). */
export function projectTemplatesDir(project: string): string {
  return `${project}/.config/templates`
}

/** Lista las plantillas del ámbito de un proyecto (nombres). */
export function listProjectTemplates(
  project: string,
  root: string = getEnv().REPORTS_ROOT,
): string[] {
  const realRoot = realpathSync(root)
  const dir = path.join(realRoot, projectTemplatesDir(project))
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }))
}

/**
 * Resolución con ámbito (paso 7.4): la plantilla DE PROYECTO tiene prioridad
 * sobre la global con el mismo nombre. Sin `project`, solo mira la global.
 *
 * @returns null si no existe en ningún ámbito.
 */
export function findTemplate(
  name: string,
  options: { project?: string; root?: string } = {},
): TemplateHit | null {
  const root = options.root ?? getEnv().REPORTS_ROOT
  const file = normalizeName(name)
  const read = (dirRel: string): TemplateHit | null => {
    try {
      const abs = resolveSafe(`${dirRel}/${file}`, root)
      return { name: file, scope: dirRel === TEMPLATES_DIR ? 'global' : 'project', content: readFileSync(abs, 'utf8') }
    } catch {
      return null
    }
  }
  if (options.project) {
    const hit = read(projectTemplatesDir(options.project))
    if (hit) return hit
  }
  return read(TEMPLATES_DIR)
}

/**
 * Plantilla por defecto (7.3, traducida al inglés en 7.5). Estructura
 * deducida de los reportes reales del usuario (demo_project): metadatos en
 * negrita, nota de reglas del programa, resumen ejecutivo, hallazgos
 * numerados con código vulnerable + request/respuesta, impacto,
 * remediación y referencias. Los placeholders {{clave}} se mantienen
 * (en español) por decisión del checkpoint 8.0.
 */
export const DEFAULT_TEMPLATE_NAME = 'ywh.md'

export const DEFAULT_TEMPLATE = [
  '# {{titulo}}',
  '',
  '**Target:** {{target}}  ',
  '**Program:** {{programa}}  ',
  '**Type:** {{tipo}}  ',
  '**Severity:** {{severidad}} (CVSS {{cvss}})  ',
  '**Date:** {{fecha}}',
  '',
  '> ⚠️ **Program rules notice:** rate-limited requests, program UA, no mass scanning, and never manipulate or destroy user data.',
  '',
  '---',
  '',
  '## Executive Summary',
  '',
  '{{resumen}}',
  '',
  '## Finding 1 — {{hallazgo}}',
  '',
  '- **Severity:** {{severidad}}  ',
  '- **Classification:** {{clasificacion}}  ',
  '- **Code:** `{{codigo}}`',
  '',
  '### Vulnerable Code',
  '',
  '{{codigo_vulnerable}}',
  '',
  '### Steps to Reproduce / Request',
  '',
  '{{request}}',
  '',
  '### Response',
  '',
  '{{respuesta}}',
  '',
  '## Impact',
  '',
  '{{impacto}}',
  '',
  '## Remediation',
  '',
  '{{remediacion}}',
  '',
  '## References',
  '',
  '{{referencias}}',
  '',
].join('\n')

/**
 * Versiones anteriores del default. Si ywh.md coincide byte a byte con
 * alguna, es un default obsoleto (no una edición del usuario) y
 * ensureDefaultTemplate lo actualiza a la versión actual.
 */
/** Opción de plantilla para selectores (10.1). */
export interface TemplateOption {
  name: string
  scope: 'project' | 'global'
}

/**
 * Todas las plantillas aplicables a un proyecto, con ámbito: primero las
 * del proyecto (prioridad) y después las globales no sombreadas por una
 * homónima de proyecto. Orden natural dentro de cada grupo.
 */
export function listTemplateOptions(
  project: string,
  root: string = getEnv().REPORTS_ROOT,
): TemplateOption[] {
  const proj = listProjectTemplates(project, root)
  const glob = listTemplates(root).filter((n) => !proj.includes(n))
  return [
    ...proj.map((name) => ({ name, scope: 'project' as const })),
    ...glob.map((name) => ({ name, scope: 'global' as const })),
  ]
}

const LEGACY_DEFAULT_TEMPLATES: string[] = [
  [
    '# {{titulo}}',
    '',
    '**Target:** {{target}}  ',
    '**Programa:** {{programa}}  ',
    '**Tipo:** {{tipo}}  ',
    '**Severidad:** {{severidad}} (CVSS {{cvss}})  ',
    '**Fecha:** {{fecha}}',
    '',
    '> ⚠️ **Nota de reglas del programa:** peticiones espaciadas, UA del programa, sin escaneo masivo, prohibido manipular/destruir datos de usuarios.',
    '',
    '---',
    '',
    '## Resumen ejecutivo',
    '',
    '{{resumen}}',
    '',
    '## Hallazgo 1 — {{hallazgo}}',
    '',
    '- **Severidad:** {{severidad}}  ',
    '- **Clasificación:** {{clasificacion}}  ',
    '- **Código:** `{{codigo}}`',
    '',
    '### Código vulnerable',
    '',
    '{{codigo_vulnerable}}',
    '',
    '### Reproducción / Request',
    '',
    '{{request}}',
    '',
    '### Respuesta',
    '',
    '{{respuesta}}',
    '',
    '## Impacto',
    '',
    '{{impacto}}',
    '',
    '## Remediación',
    '',
    '{{remediacion}}',
    '',
    '## Referencias',
    '',
    '{{referencias}}',
    '',
  ].join('\n'),
]

/**
 * Garantiza que existe la plantilla por defecto. NO invasiva con ediciones
 * del usuario, PERO sí migra defaults obsoletos: si el contenido actual
 * coincide byte a byte con una versión legacy, se actualiza a la actual.
 */
export function ensureDefaultTemplate(root: string = getEnv().REPORTS_ROOT): string {
  const current = (() => {
    try {
      return readTemplate(DEFAULT_TEMPLATE_NAME, root).content
    } catch {
      return undefined
    }
  })()

  if (current === undefined || LEGACY_DEFAULT_TEMPLATES.includes(current)) {
    saveTemplate(DEFAULT_TEMPLATE_NAME, DEFAULT_TEMPLATE, root)
  }
  return DEFAULT_TEMPLATE_NAME
}
