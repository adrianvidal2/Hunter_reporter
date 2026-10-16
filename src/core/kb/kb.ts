import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from '../../lib/env'
import { writeAtomic } from '../fs/atomic'
import { resolveSafe, resolveSafeAllowMissing } from '../fs/paths'
import { InvalidFilenameError, sanitizeFilename } from '../fs/sanitize'
import { trashFile } from '../fs/trash'
import { InvalidPromptNameError, slugifyPromptName } from '../prompts/prompts'
import { splitFrontMatter, unquote } from '../reports/frontmatter'

/**
 * Base de conocimiento estilo Agent Skills (Tarea 6a). Núcleo PURO: sin
 * Next, sin red, sin BD.
 *
 * - Una carpeta `<slug>/SKILL.md` por entrada, en DOS ámbitos:
 *   global `<root>/.config/kb/` y de proyecto `<root>/<proyecto>/.config/kb/`.
 *   `.config` es carpeta oculta: ni listProjects la lista ni el watcher la
 *   vigila (igual que plantillas y prompts).
 * - Front-matter: `name` (lowercase-hyphen), `description` (qué + cuándo),
 *   `category` (tecnica|reporte), `tags?`. Cuerpo lean. `references/` plano
 *   junto al SKILL.md, listado al cargar y leído bajo demanda.
 * - Discovery por ÍNDICE: `listKbIndex` devuelve SOLO metadatos (nunca el
 *   cuerpo) para que un agente elija qué cargar (progressive disclosure).
 * - Precedencia calcada de `findTemplate`: con proyecto, el de proyecto
 *   GANA al global con el mismo slug; sin proyecto, solo global.
 * - Rutas con resolveSafe*; escritura atómica; borrado → `.trash/`.
 */

export const KB_DIR = '.config/kb'

export type KbCategory = 'tecnica' | 'reporte'

export const KB_CATEGORIES: KbCategory[] = ['tecnica', 'reporte']

/** El nombre/slug/referencia de KB no es usable (vacío, separadores, ".."). */
export class InvalidKbNameError extends Error {
  constructor(raw: string, reason: string) {
    super(`Nombre de entrada KB inválido (${reason}): ${JSON.stringify(raw)}`)
    this.name = 'InvalidKbNameError'
  }
}

/** Ya existe una entrada con ese slug en ese ámbito: no machaca en silencio. */
export class KbCollisionError extends Error {
  constructor(slug: string, scope: string) {
    super(`Ya existe una entrada KB «${slug}» en el ámbito ${scope === 'global' ? 'global' : `del proyecto «${scope}»`}. No se sobrescribió nada.`)
    this.name = 'KbCollisionError'
  }
}

/** La entrada pedida no existe en ningún ámbito aplicable. */
export class KbNotFoundError extends Error {
  constructor(slug: string) {
    super(`No existe ninguna entrada KB con slug «${slug}».`)
    this.name = 'KbNotFoundError'
  }
}

export interface KbMeta {
  slug: string
  name: string
  description: string
  category: KbCategory
  /** Dónde RESUELVE la entrada (precedencia proyecto>global). */
  scope: 'global' | 'project'
}

export interface KbIndexEntry extends KbMeta {
  tags: string[]
}

export interface KbEntry extends KbIndexEntry {
  body: string
  /** Ficheros planos de `<slug>/references/`, por nombre (carga bajo demanda). */
  references: string[]
}

export interface KbInput {
  /** Nombre Agent-Skills (lowercase-hyphen): de aquí sale el slug. */
  name: string
  description?: string
  category?: KbCategory
  tags?: string[]
  body?: string
}

export interface KbScopeOptions {
  /** 'global' (por defecto) o nombre de proyecto. */
  scope?: string
  root?: string
}

/** Directorio KB de un proyecto (relativo al root). */
export function projectKbDir(project: string): string {
  return `${project}/.config/kb`
}

function scopeDir(scope: string): string {
  return scope === 'global' ? KB_DIR : projectKbDir(scope)
}

function scopeLabel(scope: string): 'global' | 'project' {
  return scope === 'global' ? 'global' : 'project'
}

/** Valida/normaliza un slug de carpeta: un segmento [a-z0-9-], sin "..". */
function normalizeKbSlug(slug: string): string {
  if (typeof slug !== 'string' || slug.trim() === '') {
    throw new InvalidKbNameError(slug, 'vacío')
  }
  if (/[/\\]/.test(slug) || slug.includes('..')) {
    throw new InvalidKbNameError(slug, 'separadores o ".." no permitidos')
  }
  const out = slug.toLowerCase()
  if (!/^[a-z0-9-]+$/.test(out)) {
    throw new InvalidKbNameError(slug, 'solo [a-z0-9-] (lowercase-hyphen)')
  }
  return out
}

/** Slug desde nombre legible: reutiliza el slugify de prompts. */
export function slugifyKbName(name: string): string {
  try {
    return normalizeKbSlug(slugifyPromptName(name))
  } catch (err) {
    if (err instanceof InvalidPromptNameError) {
      throw new InvalidKbNameError(name, err.message.replace(/^Nombre de prompt inválido \(/, '').replace(/\):.*$/, ''))
    }
    throw err
  }
}

function ensureKbDir(dirRel: string, root: string): void {
  mkdirSync(path.join(realpathSync(root), dirRel), { recursive: true })
}

// ── Serialización / parseo tolerante ────────────────────────────────────

function serializeKb(entry: { name: string; description: string; category: KbCategory; tags: string[]; body: string }): string {
  const lines = [
    '---',
    `name: ${entry.name}`,
    `description: "${entry.description.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    `category: ${entry.category}`,
  ]
  if (entry.tags.length > 0) lines.push(`tags: [${entry.tags.join(', ')}]`)
  lines.push('---', '', entry.body)
  return lines.join('\n')
}

/** Tags desde fm: `[a, b]` flow, `a, b` plano, o vacío. */
function parseKbTags(value: string): string[] {
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '')
  if (inner.trim() === '') return []
  return inner
    .split(',')
    .map((t) => unquote(t.trim()))
    .filter((t) => t !== '')
}

/** Extrae la entrada de un SKILL.md. Tolerante: fm ausente o con tipos
 *  raros → defaults (name=slug, description='', category='tecnica'). */
function parseKbSkill(slug: string, raw: string): Omit<KbEntry, 'slug' | 'scope' | 'references'> {
  const split = splitFrontMatter(raw)
  let name = slug
  let description = ''
  let category: KbCategory = 'tecnica'
  let tags: string[] = []
  if (split.hasFm) {
    for (const line of split.lines) {
      const m = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(line)
      if (!m) continue
      const key = m[1]!
      const value = unquote(m[2]!.trim())
      if (key === 'name' && value.trim() !== '') name = value.trim()
      else if (key === 'description') description = value
      else if (key === 'category' && (KB_CATEGORIES as string[]).includes(value)) category = value as KbCategory
      else if (key === 'tags') tags = parseKbTags(value)
    }
  }
  return { name, description, category, tags, body: split.body.trimStart() }
}

// ── Lectura por ámbito ──────────────────────────────────────────────────

function listReferences(dirAbs: string): string[] {
  const refsDir = path.join(dirAbs, 'references')
  if (!existsSync(refsDir)) return []
  try {
    return readdirSync(refsDir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

/** Lee la entrada de UN ámbito explícito. Lanza KbNotFoundError si falta. */
function readKbScope(slug: string, scope: string, root: string): KbEntry {
  const clean = normalizeKbSlug(slug)
  const dirAbs = resolveSafeAllowMissing(`${scopeDir(scope)}/${clean}`, root)
  const skillAbs = path.join(dirAbs, 'SKILL.md')
  if (!existsSync(skillAbs)) throw new KbNotFoundError(clean)
  const parsed = parseKbSkill(clean, readFileSync(skillAbs, 'utf8'))
  return {
    slug: clean,
    scope: scopeLabel(scope),
    references: listReferences(dirAbs),
    ...parsed,
  }
}

/** Slugs presentes en un ámbito (carpetas con SKILL.md), orden natural. */
function listKbScopeSlugs(scope: string, root: string): string[] {
  const realRoot = realpathSync(root)
  const dir = path.join(realRoot, scopeDir(scope))
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(path.join(dir, e.name, 'SKILL.md')))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }))
  } catch {
    return []
  }
}

// ── API pública ─────────────────────────────────────────────────────────

/**
 * ÍNDICE de discovery: SOLO metadatos (jamás el cuerpo), global + proyecto
 * con precedencia proyecto>global en el mismo slug. `category` filtra.
 */
export function listKbIndex(
  opts: { project?: string; category?: KbCategory; root?: string } = {},
): KbIndexEntry[] {
  const root = opts.root ?? getEnv().REPORTS_ROOT
  const merged = new Map<string, KbIndexEntry>()
  for (const slug of listKbScopeSlugs('global', root)) {
    const e = readKbScope(slug, 'global', root)
    merged.set(slug, { slug: e.slug, name: e.name, description: e.description, category: e.category, tags: e.tags, scope: 'global' })
  }
  if (opts.project) {
    for (const slug of listKbScopeSlugs(opts.project, root)) {
      const e = readKbScope(slug, opts.project, root)
      merged.set(slug, { slug: e.slug, name: e.name, description: e.description, category: e.category, tags: e.tags, scope: 'project' })
    }
  }
  return [...merged.values()]
    .filter((e) => opts.category === undefined || e.category === opts.category)
    .sort((a, b) => a.slug.localeCompare(b.slug, 'es', { numeric: true, sensitivity: 'base' }))
}

/**
 * Carga completa (nivel 2/3): metadatos + cuerpo + lista de references.
 * Con `project`, el ámbito de proyecto tiene prioridad sobre el global
 * (mismo patrón que `findTemplate`); sin proyecto, solo global.
 */
export function loadKbEntry(
  slug: string,
  opts: { project?: string; root?: string } = {},
): KbEntry {
  const root = opts.root ?? getEnv().REPORTS_ROOT
  if (opts.project) {
    const dirAbs = resolveSafeAllowMissing(`${scopeDir(opts.project)}/${normalizeKbSlug(slug)}`, root)
    if (existsSync(path.join(dirAbs, 'SKILL.md'))) return readKbScope(slug, opts.project, root)
  }
  return readKbScope(slug, 'global', root)
}

/** CRUD · read: entrada de UN ámbito explícito (por defecto global). */
export function readKb(slug: string, opts: KbScopeOptions = {}): KbEntry {
  return readKbScope(slug, opts.scope ?? 'global', opts.root ?? getEnv().REPORTS_ROOT)
}

/** CRUD · create: alta NUEVA en un ámbito. Colisión de slug → error claro. */
export function createKb(
  entry: KbInput,
  opts: KbScopeOptions = {},
): KbEntry {
  const scope = opts.scope ?? 'global'
  const root = opts.root ?? getEnv().REPORTS_ROOT
  const slug = slugifyKbName(entry.name)
  const dirRel = `${scopeDir(scope)}/${slug}`
  if (existsSync(resolveSafeAllowMissing(`${dirRel}/SKILL.md`, root))) {
    throw new KbCollisionError(slug, scope)
  }
  ensureKbDir(dirRel, root)
  const full = {
    name: slug,
    description: entry.description ?? '',
    category: entry.category ?? 'tecnica',
    tags: entry.tags ?? [],
    body: entry.body ?? '',
  }
  writeAtomic(`${dirRel}/SKILL.md`, serializeKb(full), { root })
  return { ...full, slug, scope: scopeLabel(scope), references: [] }
}

/** CRUD · update: parchea una entrada EXISTENTE. Renombrar cambia el slug
 *  (colisión → error) y el dir viejo va a `.trash/`. */
export function updateKb(
  slug: string,
  patch: Partial<Pick<KbInput, 'name' | 'description' | 'category' | 'tags'>> & { body?: string },
  opts: KbScopeOptions = {},
): KbEntry {
  const scope = opts.scope ?? 'global'
  const root = opts.root ?? getEnv().REPORTS_ROOT
  const current = readKbScope(slug, scope, root)

  const nextName = patch.name ?? current.name
  const nextSlug = slugifyKbName(nextName)
  const next = {
    name: nextSlug,
    description: patch.description ?? current.description,
    category: patch.category ?? current.category,
    tags: patch.tags ?? current.tags,
    body: patch.body ?? current.body,
  }

  const dirRel = `${scopeDir(scope)}/${nextSlug}`
  if (nextSlug !== current.slug) {
    if (existsSync(resolveSafeAllowMissing(`${dirRel}/SKILL.md`, root))) {
      throw new KbCollisionError(nextSlug, scope)
    }
  }
  ensureKbDir(dirRel, root)
  writeAtomic(`${dirRel}/SKILL.md`, serializeKb(next), { root })
  if (nextSlug !== current.slug) {
    try {
      trashFile(`${scopeDir(scope)}/${current.slug}`, root)
    } catch {
      // si el trash del dir viejo falla, el nuevo ya está creado: no es fatal
    }
  }
  return { ...next, slug: nextSlug, scope: scopeLabel(scope), references: current.references }
}

/** CRUD · delete: el `<slug>/` COMPLETO a `.trash/` (nunca unlink).
 *  @returns true si existía; false si no estaba. */
export function deleteKb(slug: string, opts: KbScopeOptions = {}): boolean {
  const scope = opts.scope ?? 'global'
  const root = opts.root ?? getEnv().REPORTS_ROOT
  const clean = normalizeKbSlug(slug)
  try {
    const dirAbs = resolveSafe(`${scopeDir(scope)}/${clean}`, root)
    if (!existsSync(path.join(dirAbs, 'SKILL.md'))) return false
    trashFile(`${scopeDir(scope)}/${clean}`, root)
    return true
  } catch (err) {
    if (err instanceof InvalidKbNameError) throw err
    return false
  }
}

/**
 * Lee UN reference plano de la entrada (bajo demanda, nivel 3). El nombre
 * se valida (sin separadores ni ".."): nada fuera de references/.
 */
export function readKbReference(
  slug: string,
  refName: string,
  opts: { project?: string; root?: string } = {},
): string {
  const clean = normalizeKbSlug(slug)
  const root = opts.root ?? getEnv().REPORTS_ROOT
  let ref: string
  try {
    ref = sanitizeFilename(refName)
  } catch (err) {
    if (err instanceof InvalidFilenameError) throw new InvalidKbNameError(refName, 'queda vacío tras sanitizar')
    throw err
  }
  if (ref !== refName) throw new InvalidKbNameError(refName, 'no es un nombre plano seguro')

  // mismo orden de resolución que loadKbEntry: proyecto primero
  const scopes = opts.project ? [opts.project, 'global'] : ['global']
  for (const scope of scopes) {
    const abs = resolveSafeAllowMissing(`${scopeDir(scope)}/${clean}/references/${ref}`, root)
    if (existsSync(abs)) return readFileSync(abs, 'utf8')
  }
  throw new KbNotFoundError(`${clean}/references/${ref}`)
}

/**
 * Contexto markdown para consumidores (agentes 06c / reportes 06d):
 * concatena EXACTAMENTE las entradas pedidas. Un slug que ya no existe se
 * salta (tolerante); `[]` → cadena vacía.
 */
export function renderKbContext(
  slugs: string[],
  opts: { project?: string; root?: string } = {},
): string {
  const blocks: string[] = []
  for (const slug of slugs) {
    let entry: KbEntry
    try {
      entry = loadKbEntry(slug, opts)
    } catch (err) {
      if (err instanceof KbNotFoundError) continue
      throw err
    }
    const desc = entry.description !== '' ? `${entry.description}\n\n` : ''
    blocks.push(`## Skill: ${entry.name} [${entry.category}]\n\n${desc}${entry.body}`.trim())
  }
  return blocks.join('\n\n')
}
