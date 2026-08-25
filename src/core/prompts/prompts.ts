import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from '../../lib/env'
import { writeAtomic } from '../fs/atomic'
import { resolveSafe, resolveSafeAllowMissing } from '../fs/paths'
import { trashFile } from '../fs/trash'
import { splitFrontMatter, unquote } from '../reports/frontmatter'

/**
 * Prompts globales de la app (asistentes LLM), CRUD.
 *
 * - Un fichero `.md` por prompt en `<root>/.config/prompts/`.
 *   `.config` es carpeta oculta → no aparece como proyecto ni lo vigila el
 *   watcher (igual que las plantillas).
 * - Formato: front-matter con `name` (nombre legible) + cuerpo = texto plano.
 * - Nombre de fichero = slug del nombre (solo [a-z0-9-], sin acentos ni
 *   espacios ni separadores de ruta).
 * - Rutas resueltas con resolveSafe* (anti path-traversal).
 * - Borrado → `.trash/` (recuperable), nunca unlink.
 */

export const PROMPTS_DIR = '.config/prompts'

/** El nombre de prompt no es usable (vacío, separadores, "..", etc.). */
export class InvalidPromptNameError extends Error {
  constructor(raw: string, reason: string) {
    super(`Nombre de prompt inválido (${reason}): ${JSON.stringify(raw)}`)
    this.name = 'InvalidPromptNameError'
  }
}

/** Ya existe un prompt con ese slug: no machaco en silencio. */
export class PromptCollisionError extends Error {
  constructor(slug: string) {
    super(`Ya existe un prompt con slug «${slug}». No se sobrescribió nada.`)
    this.name = 'PromptCollisionError'
  }
}

/** El prompt pedido no existe. */
export class PromptNotFoundError extends Error {
  constructor(slug: string) {
    super(`No existe ningún prompt con slug «${slug}».`)
    this.name = 'PromptNotFoundError'
  }
}

export interface PromptMeta {
  slug: string
  name: string
  content: string
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
function ts(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** Slug del fichero a partir del nombre legible. */
export function slugifyPromptName(name: string): string {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new InvalidPromptNameError(name, 'vacío')
  }
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar acentos/diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // espacios/puntuación → guión
    .replace(/^-+|-+$/g, '') // recortar guiones
    .slice(0, 80) // tope de longitud
  if (slug === '') throw new InvalidPromptNameError(name, 'el slug queda vacío tras normalizar')
  return slug
}

/** Normaliza un slug a `algo.md` (un solo segmento, sin ".."). */
function normalizeSlug(slug: string): string {
  if (typeof slug !== 'string' || slug.trim() === '') {
    throw new InvalidPromptNameError(slug, 'vacío')
  }
  if (/[/\\]/.test(slug) || slug.includes('..')) {
    throw new InvalidPromptNameError(slug, 'separadores o ".." no permitidos')
  }
  let out = slug.toLowerCase()
  if (!/^[a-z0-9-]+$/.test(out)) {
    throw new InvalidPromptNameError(slug, 'solo [a-z0-9-]'
      )
  }
  return out.endsWith('.md') ? out : `${out}.md`
}

/** Ruta absoluta del directorio de prompts (lo crea si falta). */
export function ensurePromptsDir(root: string = getEnv().REPORTS_ROOT): string {
  const realRoot = realpathSync(root)
  const dir = path.join(realRoot, PROMPTS_DIR)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Serializa un prompt a `.md` con front-matter `name:` + cuerpo. */
export function serializePrompt(name: string, content: string): string {
  return `---\nname: ${name}\n---\n\n${content}`
}

/** Extrae {name, body} de un `.md` de prompt (tolerante a que falte fm). */
export function parsePromptFile(slug: string, raw: string): PromptMeta {
  const split = splitFrontMatter(raw)
  let name = slug
  if (split.hasFm) {
    for (const line of split.lines) {
      const m = /^name\s*:\s*(.*)$/.exec(line)
      if (m) {
        const v = unquote(m[1]!.trim())
        if (v !== '') name = v
        break
      }
    }
  }
  return { slug, name, content: split.body.trimStart() }
}

/** Slugs de prompts existentes (sin extensión), orden natural. */
export function listPromptSlugs(root: string = getEnv().REPORTS_ROOT): string[] {
  const realRoot = realpathSync(root)
  const dir = path.join(realRoot, PROMPTS_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .map((f) => f.replace(/\.md$/i, ''))
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }))
}

/** Lista completa (slug + name + cuerpo) para render. */
export function listPrompts(root: string = getEnv().REPORTS_ROOT): PromptMeta[] {
  return listPromptSlugs(root)
    .map((slug) => {
      try {
        const abs = resolveSafe(`${PROMPTS_DIR}/${normalizeSlug(slug)}`, root)
        return parsePromptFile(slug, readFileSync(abs, 'utf8'))
      } catch {
        return null
      }
    })
    .filter((p): p is PromptMeta => p !== null)
}

/** Lee un prompt por slug. Lanza PromptNotFound si no existe. */
export function readPrompt(slug: string, root: string = getEnv().REPORTS_ROOT): PromptMeta {
  const file = normalizeSlug(slug)
  const abs = resolveSafeAllowMissing(`${PROMPTS_DIR}/${file}`, root)
  if (!existsSync(abs)) throw new PromptNotFoundError(slug)
  return parsePromptFile(slug.replace(/\.md$/i, ''), readFileSync(abs, 'utf8'))
}

/**
 * Crea un prompt NUEVO. Si ya existe un fichero con ese slug, lanza
 * PromptCollisionError (no sobrescribe en silencio).
 */
export function createPrompt(
  name: string,
  content: string,
  root: string = getEnv().REPORTS_ROOT,
): PromptMeta {
  const slug = slugifyPromptName(name)
  const file = normalizeSlug(slug)
  const abs = resolveSafeAllowMissing(`${PROMPTS_DIR}/${file}`, root)
  if (existsSync(abs)) throw new PromptCollisionError(slug)
  ensurePromptsDir(root)
  writeAtomic(`${PROMPTS_DIR}/${file}`, serializePrompt(name, content), { root })
  return { slug, name, content }
}

/**
 * Actualiza un prompt EXISTENTE (contenido y/o nombre). Si se renombra a un
 * slug que ya tiene OTRO prompt distinto del actual, lanza
 * PromptCollisionError.
 */
export function updatePrompt(
  slug: string,
  patch: { name?: string; content?: string },
  root: string = getEnv().REPORTS_ROOT,
): PromptMeta {
  const current = readPrompt(slug, root)
  const nextName = patch.name ?? current.name
  const nextContent = patch.content ?? current.content
  const nextSlug = slugifyPromptName(nextName)
  const file = normalizeSlug(nextSlug)

  if (nextSlug !== slug) {
    const abs = resolveSafeAllowMissing(`${PROMPTS_DIR}/${file}`, root)
    if (existsSync(abs)) throw new PromptCollisionError(nextSlug)
  }
  ensurePromptsDir(root)

  if (nextSlug === slug) {
    // mismo slug: sobrescribir el fichero
    writeAtomic(`${PROMPTS_DIR}/${file}`, serializePrompt(nextName, nextContent), { root })
    return { slug, name: nextName, content: nextContent }
  }
  // renombrado: escribir nuevo slug y mover el viejo a .trash
  writeAtomic(`${PROMPTS_DIR}/${file}`, serializePrompt(nextName, nextContent), { root })
  try {
    trashFile(`${PROMPTS_DIR}/${normalizeSlug(slug)}`, root)
  } catch {
    // si el borrado falla (ENOENT), el nuevo ya está creado: no es fatal
  }
  return { slug: nextSlug, name: nextName, content: nextContent }
}

/** Borra un prompt moviéndolo a `.trash/`. false si no existía. */
export function deletePrompt(slug: string, root: string = getEnv().REPORTS_ROOT): boolean {
  const file = normalizeSlug(slug)
  try {
    const abs = resolveSafe(`${PROMPTS_DIR}/${file}`, root)
    if (!existsSync(abs)) return false
    trashFile(`${PROMPTS_DIR}/${file}`, root)
    return true
  } catch {
    return false
  }
}

/** Fuerza la creación del directorio si falta (p. ej. en la página). */
export function ensurePromptsDirExists(root: string = getEnv().REPORTS_ROOT): boolean {
  ensurePromptsDir(root)
  return true
}
