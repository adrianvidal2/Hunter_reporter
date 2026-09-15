#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Migración de proyectos heredados (pasos 4 y revisión):
 *
 *   1. `platform.json` → `<proyecto>/.config/platform.json`
 *      (crea la marca en los que no la tengan; MUEVE los que la tengan
 *      suelta en la raíz, formato del paso 4 original).
 *   2. `programa.json` → `<proyecto>/pentest/programa.json`
 *      (MUEVE el suelto en la raíz de proyectos heredados de antes de
 *      `pentest/`; valida JSON antes de mover).
 *
 * SECO POR DEFECTO: sin argumentos solo INFORMA de qué haría en cada
 * proyecto, sin escribir nada. Con `--write` aplica. Los que ya están
 * migrados se saltan.
 *
 * Uso:
 *   pnpm migrate:platform           # en seco
 *   pnpm migrate:platform -- --write
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(here, '..')

function readReportsRoot() {
  if (process.env.REPORTS_ROOT) return path.resolve(process.env.REPORTS_ROOT)
  const envFile = path.join(appRoot, '.env.local')
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const m = /^\s*REPORTS_ROOT\s*=\s*"?([^"\n#]+)"?\s*$/.exec(line)
      if (m) return path.resolve(m[1].trim())
    }
  }
  console.error('ERROR: REPORTS_ROOT no está en el entorno ni en .env.local')
  process.exit(1)
}

/** slug del programa.json (raíz o pentest/), o null. */
function readSlug(dir: string): string | null {
  for (const rel of ['pentest/programa.json', 'programa.json']) {
    const p = path.join(dir, rel)
    if (!existsSync(p)) continue
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8'))
      if (typeof parsed.slug === 'string' && parsed.slug !== '') return parsed.slug
    } catch {
      /* raíz corrupta: no bloquea la migración de marca */
    }
  }
  return null
}

const root = readReportsRoot()
const write = process.argv.includes('--write')

if (!existsSync(root)) {
  console.error(`ERROR: REPORTS_ROOT no existe: ${root}`)
  process.exit(1)
}

const entries = readdirSync(root, { withFileTypes: true }).filter(
  (e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== '_inbox',
)

console.log(`REPORTS_ROOT: ${root}`)
console.log(`Modo: ${write ? 'ESCRITURA (--write)' : 'SECO (usa --write para aplicar)'}\n`)

let touched = 0
const skipped: string[] = []
const untouched: string[] = []

for (const e of entries) {
  const dir = path.join(root, e.name)
  const actions: string[] = []
  const doActions: (() => void)[] = []

  // ── platform.json ──────────────────────────────────────────────
  if (existsSync(path.join(dir, '.config', 'platform.json'))) {
    // ya marcado: nada que hacer con la marca
  } else if (existsSync(path.join(dir, 'platform.json'))) {
    actions.push('platform.json → .config/platform.json (legacy, mover)')
    doActions.push(() => {
      mkdirSync(path.join(dir, '.config'), { recursive: true })
      writeFileSync(path.join(dir, '.config', 'platform.json'), readFileSync(path.join(dir, 'platform.json')))
      rmSync(path.join(dir, 'platform.json'))
    })
  } else if (existsSync(path.join(dir, 'programa.json')) || existsSync(path.join(dir, 'pentest', 'programa.json'))) {
    const slug = readSlug(dir) ?? e.name
    actions.push(`crear .config/platform.json (platform: yeswehack, slug: ${slug})`)
    doActions.push(() => {
      mkdirSync(path.join(dir, '.config'), { recursive: true })
      writeFileSync(
        path.join(dir, '.config', 'platform.json'),
        JSON.stringify({ platform: 'yeswehack', slug, migrated: true, updatedAt: new Date().toISOString() }, null, 2) + '\n',
      )
    })
  }

  // ── programa.json heredado en la raíz → pentest/ ───────────────
  if (
    !existsSync(path.join(dir, 'pentest', 'programa.json')) &&
    existsSync(path.join(dir, 'programa.json'))
  ) {
    let valid = false
    try {
      JSON.parse(readFileSync(path.join(dir, 'programa.json'), 'utf8'))
      valid = true
    } catch {
      actions.push('programa.json en la raíz CORRUPTO: NO se toca (revísalo a mano)')
    }
    if (valid) {
      actions.push('programa.json → pentest/programa.json (heredado, mover)')
      doActions.push(() => {
        mkdirSync(path.join(dir, 'pentest'), { recursive: true })
        renameSync(path.join(dir, 'programa.json'), path.join(dir, 'pentest', 'programa.json'))
      })
    }
  }

  if (actions.length === 0) {
    skipped.push(e.name)
    continue
  }
  touched++
  console.log(`· ${e.name}`)
  for (const a of actions) console.log(`    ${a}`)
  if (write) for (const f of doActions) f()
}

console.log('')
if (skipped.length > 0) console.log(`Ya migrados (se saltan): ${skipped.join(', ')}`)
if (untouched.length > 0) console.log(`Sin programa.json ni marca (NO se tocan): ${untouched.join(', ')}`)
if (!write && touched > 0) {
  console.log(`\nSeco: ${touched} proyecto(s) afectado(s), nada escrito. Confirma y ejecuta con --write.`)
} else if (write) {
  console.log(`\nAplicado: ${touched} proyecto(s) migrado(s).`)
}
