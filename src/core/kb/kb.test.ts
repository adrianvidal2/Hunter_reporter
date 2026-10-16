import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createKb,
  deleteKb,
  InvalidKbNameError,
  KbCollisionError,
  KbNotFoundError,
  listKbIndex,
  loadKbEntry,
  projectKbDir,
  readKb,
  readKbReference,
  renderKbContext,
  updateKb,
} from './kb'

let root: string
const created: string[] = []

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kb-'))
  created.push(root)
})

afterAll(() => {
  for (const p of created) rmSync(p, { recursive: true, force: true })
})

const ENTRY = {
  name: 'sql-injection-playbook',
  description: 'Cómo probar SQLi manual + automatizado; usar al auditar formularios.',
  category: 'tecnica' as const,
  tags: ['sqli', 'web'],
  body: '## Pasos\n\n1. Detectar\n2. Confirmar\n',
}

/** Crea a mano un SKILL.md crudo (para tests de parseo tolerante). */
function writeRawSkill(scopeDirRel: string, slug: string, raw: string): void {
  const dir = join(root, scopeDirRel, slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), raw)
}

describe('CRUD por ámbito (global y proyecto)', () => {
  it('create en global y en proyecto escribe <slug>/SKILL.md con front-matter; readKb los devuelve', () => {
    const g = createKb(ENTRY, { scope: 'global', root })
    expect(g.slug).toBe('sql-injection-playbook')
    expect(g.scope).toBe('global')
    const globalPath = join(root, '.config/kb/sql-injection-playbook/SKILL.md')
    expect(existsSync(globalPath)).toBe(true)
    expect(readFileSync(globalPath, 'utf8')).toContain('category: tecnica')

    const p = createKb({ ...ENTRY, name: 'xss-playbook', body: 'cuerpo xss' }, { scope: 'acme', root })
    expect(p.scope).toBe('project')
    expect(existsSync(join(root, projectKbDir('acme'), 'xss-playbook', 'SKILL.md'))).toBe(true)

    const rg = readKb('sql-injection-playbook', { scope: 'global', root })
    expect(rg.body).toBe('## Pasos\n\n1. Detectar\n2. Confirmar\n')
    expect(rg.description).toBe(ENTRY.description)
    expect(rg.tags).toEqual(['sqli', 'web'])

    const rp = readKb('xss-playbook', { scope: 'acme', root })
    expect(rp.body).toBe('cuerpo xss')
  })

  it('update parchea campos y el rename cambia el slug llevando el dir viejo a .trash', () => {
    createKb(ENTRY, { scope: 'global', root })
    const updated = updateKb('sql-injection-playbook', { body: 'nuevo cuerpo', tags: ['sqli'] }, { scope: 'global', root })
    expect(updated.body).toBe('nuevo cuerpo')
    expect(readKb('sql-injection-playbook', { scope: 'global', root }).tags).toEqual(['sqli'])

    const renamed = updateKb('sql-injection-playbook', { name: 'sqli manual' }, { scope: 'global', root })
    expect(renamed.slug).toBe('sqli-manual')
    expect(existsSync(join(root, '.config/kb/sql-injection-playbook'))).toBe(false)
    expect(readKb('sqli-manual', { scope: 'global', root }).body).toBe('nuevo cuerpo')
    // el dir viejo está en .trash (recuperable)
    const trash = join(root, '.trash')
    expect(readdirSync(trash).some((d) => d.endsWith('-sql-injection-playbook'))).toBe(true)
  })

  it('delete mueve el <slug>/ COMPLETO a .trash (nunca unlink); segunda vez → false', () => {
    mkdirSync(join(root, '.config/kb/report-template/references'), { recursive: true })
    createKb({ ...ENTRY, name: 'report-template', category: 'reporte' }, { scope: 'global', root })
    writeFileSync(join(root, '.config/kb/report-template/references/ejemplo.md'), 'ejemplo')

    expect(deleteKb('report-template', { scope: 'global', root })).toBe(true)
    expect(existsSync(join(root, '.config/kb/report-template'))).toBe(false)
    const trashDir = readdirSync(join(root, '.trash')).find((d) => d.endsWith('-report-template'))!
    expect(existsSync(join(root, '.trash', trashDir, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(root, '.trash', trashDir, 'references', 'ejemplo.md'))).toBe(true)
    expect(deleteKb('report-template', { scope: 'global', root })).toBe(false)
  })
})

describe('precedencia y aislamiento de ámbitos', () => {
  it('mismo slug en proyecto y global → gana el de PROYECTO en índice y carga', () => {
    createKb({ ...ENTRY, body: 'cuerpo GLOBAL', description: 'desc global' }, { scope: 'global', root })
    createKb({ ...ENTRY, body: 'cuerpo PROYECTO', description: 'desc proyecto' }, { scope: 'acme', root })

    const idx = listKbIndex({ project: 'acme', root })
    expect(idx).toHaveLength(1)
    expect(idx[0]).toMatchObject({ slug: 'sql-injection-playbook', scope: 'project', description: 'desc proyecto' })

    const loaded = loadKbEntry('sql-injection-playbook', { project: 'acme', root })
    expect(loaded.body).toBe('cuerpo PROYECTO')
    expect(loaded.scope).toBe('project')

    // sin proyecto: solo existe el global
    expect(loadKbEntry('sql-injection-playbook', { root }).body).toBe('cuerpo GLOBAL')
  })

  it('aislamiento: una entrada del proyecto A NO aparece para B ni en global', () => {
    createKb(ENTRY, { scope: 'proyecto-a', root })
    createKb({ ...ENTRY, name: 'global-entry' }, { scope: 'global', root })

    const forB = listKbIndex({ project: 'proyecto-b', root })
    expect(forB.map((e) => e.slug)).toEqual(['global-entry']) // la de A no se filtra a B
    const globalOnly = listKbIndex({ root })
    expect(globalOnly.map((e) => e.slug)).toEqual(['global-entry'])
    expect(() => loadKbEntry('sql-injection-playbook', { project: 'proyecto-b', root })).toThrow(KbNotFoundError)
    expect(() => loadKbEntry('sql-injection-playbook', { root })).toThrow(KbNotFoundError)
  })
})

describe('listKbIndex (discovery: SOLO metadatos)', () => {
  it('devuelve metadatos exactos, SIN cuerpo ni references; filtra por category', () => {
    createKb(ENTRY, { scope: 'global', root })
    createKb({
      name: 'how-to-report-idor',
      description: 'Estructura de reporte IDOR; usar al redactar.',
      category: 'reporte',
      body: 'plantilla cuerpo',
    }, { scope: 'global', root })

    const idx = listKbIndex({ root })
    expect(idx).toHaveLength(2)
    for (const e of idx) {
      expect(Object.keys(e).sort()).toEqual(['category', 'description', 'name', 'scope', 'slug', 'tags'])
    }
    expect(idx.map((e) => e.slug)).toEqual(['how-to-report-idor', 'sql-injection-playbook']) // orden natural

    const reports = listKbIndex({ category: 'reporte', root })
    expect(reports.map((e) => e.slug)).toEqual(['how-to-report-idor'])
    const tecnicas = listKbIndex({ category: 'tecnica', root })
    expect(tecnicas.map((e) => e.slug)).toEqual(['sql-injection-playbook'])
  })

  it('directorios sin SKILL.md no son entradas', () => {
    mkdirSync(join(root, '.config/kb/vacia'), { recursive: true })
    createKb(ENTRY, { scope: 'global', root })
    expect(listKbIndex({ root }).map((e) => e.slug)).toEqual(['sql-injection-playbook'])
  })
})

describe('loadKbEntry (cuerpo + references bajo demanda)', () => {
  it('lista references/ plano ordenado; readKbReference lee por nombre', () => {
    createKb(ENTRY, { scope: 'global', root })
    const refsDir = join(root, '.config/kb/sql-injection-playbook/references')
    mkdirSync(refsDir, { recursive: true })
    writeFileSync(join(refsDir, 'payloads.txt'), "' OR 1=1 --")
    writeFileSync(join(refsDir, 'cheatsheet.md'), '# Cheatsheet')

    const entry = loadKbEntry('sql-injection-playbook', { root })
    expect(entry.references).toEqual(['cheatsheet.md', 'payloads.txt']) // ordenado
    expect(readKbReference('sql-injection-playbook', 'payloads.txt', { root })).toBe("' OR 1=1 --")

    // con proyecto: si el global lo tiene, se resuelve
    expect(readKbReference('sql-injection-playbook', 'cheatsheet.md', { project: 'acme', root })).toBe('# Cheatsheet')
  })

  it('reference con nombre NO plano (separadores, ..) → rechazado sin leer nada', () => {
    createKb(ENTRY, { scope: 'global', root })
    const refsDir = join(root, '.config/kb/sql-injection-playbook/references')
    mkdirSync(refsDir, { recursive: true })
    writeFileSync(join(refsDir, 'secreto.txt'), 'secreto')
    mkdirSync(join(root, 'secrets'), { recursive: true })
    writeFileSync(join(root, 'secrets', 'fuera.txt'), 'fuera del scope')

    expect(() => readKbReference('sql-injection-playbook', '../secrets/fuera.txt', { root })).toThrow(InvalidKbNameError)
    expect(() => readKbReference('sql-injection-playbook', 'sub/dir.txt', { root })).toThrow(InvalidKbNameError)
    expect(() => readKbReference('sql-injection-playbook', 'no-existe.txt', { root })).toThrow(KbNotFoundError)
  })
})

describe('renderKbContext (contexto para consumidores)', () => {
  it('concatena EXACTAMENTE las entradas elegidas; [] → cadena vacía; slug ausente se salta', () => {
    createKb({ ...ENTRY, body: 'CUERPO-A' }, { scope: 'global', root })
    createKb({
      ...ENTRY,
      name: 'report-idor',
      description: 'Estructura de reporte IDOR; usar al redactar.',
      category: 'reporte',
      body: 'CUERPO-B',
      tags: [],
    }, { scope: 'global', root })

    expect(renderKbContext([], { root })).toBe('')
    const two = renderKbContext(['sql-injection-playbook', 'report-idor'], { root })
    expect(two).toBe(
      '## Skill: sql-injection-playbook [tecnica]\n\n' +
      'Cómo probar SQLi manual + automatizado; usar al auditar formularios.\n\n' +
      'CUERPO-A\n\n' +
      '## Skill: report-idor [reporte]\n\n' +
      'Estructura de reporte IDOR; usar al redactar.\n\n' +
      'CUERPO-B',
    )
    // uno de los dos pedidos ya no existe: se salta sin romper
    expect(renderKbContext(['sql-injection-playbook', 'fantasma'], { root })).toContain('CUERPO-A')
    expect(renderKbContext(['sql-injection-playbook', 'fantasma'], { root })).not.toContain('fantasma')
  })

  it('respeta la precedencia del proyecto', () => {
    createKb({ ...ENTRY, body: 'GLOBAL' }, { scope: 'global', root })
    createKb({ ...ENTRY, body: 'PROYECTO' }, { scope: 'acme', root })
    expect(renderKbContext(['sql-injection-playbook'], { project: 'acme', root })).toContain('PROYECTO')
    expect(renderKbContext(['sql-injection-playbook'], { root })).toContain('GLOBAL')
  })
})

describe('parseo tolerante y errores claros', () => {
  it('fm ausente o con tipos raros → defaults sin crash', () => {
    writeRawSkill('.config/kb', 'sin-fm', 'Solo cuerpo, sin front-matter.')
    const a = loadKbEntry('sin-fm', { root })
    expect(a).toMatchObject({ name: 'sin-fm', description: '', category: 'tecnica', tags: [], body: 'Solo cuerpo, sin front-matter.' })

    writeRawSkill('.config/kb', 'rarito', [
      '---',
      'name: 42',
      'description: [esto, es, un, array]',
      'category: 99',
      'tags: no-es-lista',
      '---',
      '',
      'cuerpo',
    ].join('\n'))
    const b = loadKbEntry('rarito', { root })
    // tolerante: la category inválida cae al default; lo textual se conserva
    expect(b.category).toBe('tecnica')
    expect(b.name).toBe('42')
    expect(b.tags).toEqual(['no-es-lista'])
    expect(b.body).toBe('cuerpo')
  })

  it('colisión de slug en el MISMO ámbito → KbCollisionError; en OTRO ámbito → ok', () => {
    createKb(ENTRY, { scope: 'global', root })
    expect(() => createKb({ ...ENTRY, body: 'otro' }, { scope: 'global', root })).toThrow(KbCollisionError)
    expect(() => createKb(ENTRY, { scope: 'acme', root })).not.toThrow()
    // update con rename a un slug ocupado → colisión
    createKb({ ...ENTRY, name: 'otra-entrada' }, { scope: 'global', root })
    expect(() => updateKb('otra-entrada', { name: 'sql-injection-playbook' }, { scope: 'global', root })).toThrow(KbCollisionError)
  })

  it('nombres inválidos y entradas inexistentes → errores con mensaje claro', () => {
    expect(() => createKb({ ...ENTRY, name: '' }, { scope: 'global', root })).toThrow(InvalidKbNameError)
    expect(() => readKb('fantasma', { scope: 'global', root })).toThrow(KbNotFoundError)
    expect(() => loadKbEntry('fantasma', { root })).toThrow(KbNotFoundError)
    expect(() => updateKb('fantasma', { body: 'x' }, { scope: 'global', root })).toThrow(KbNotFoundError)
  })

  it('round-trip: description con comillas y barras se serializa y re-lee igual', () => {
    const desc = 'Usar con "cuidado" (\\comillas\\ y todo)'
    createKb({ ...ENTRY, description: desc }, { scope: 'global', root })
    expect(readKb('sql-injection-playbook', { scope: 'global', root }).description).toBe(desc)
  })
})
