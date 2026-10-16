import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ REPORTS_ROOT: env.root }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import {
  createKbAction,
  deleteKbAction,
  promoteToKbAction,
  searchKbAction,
  listKbAction,
  loadKbEntryAction,
  readKbReferenceAction,
  updateKbAction,
} from './actions'
import { loadKbEntry } from '@/core/kb/kb'

const root = mkdtempSync(join(tmpdir(), 'kb-actions-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

beforeEach(() => {
  env.root = root
  // proyecto 'demo' existe; para listProjects basta un directorio de primer nivel
  mkdirSync(join(root, 'demo'), { recursive: true })
  // estado KB limpio entre tests (el root es compartido en este fichero)
  rmSync(join(root, '.config/kb'), { recursive: true, force: true })
  rmSync(join(root, 'demo/.config/kb'), { recursive: true, force: true })
  rmSync(join(root, '.trash'), { recursive: true, force: true })
})

const ENTRY = {
  name: 'idor-playbook',
  description: 'Cómo probar IDOR; usar al auditar APIs con ids numéricos.',
  category: 'tecnica' as const,
  tags: ['idor', 'api'],
  body: '## Pasos\n',
}

describe('listKbAction (índice por ámbito)', () => {
  it('lista global sin proyecto; global + proyecto con él; scope inexistente → error', async () => {
    expect((await createKbAction(ENTRY, 'global')).ok).toBe(true)
    expect((await createKbAction({ ...ENTRY, name: 'solo-demo', category: 'reporte' }, 'demo')).ok).toBe(true)

    const globalOnly = await listKbAction()
    expect(globalOnly.ok && globalOnly.data.map((e) => e.slug)).toEqual(['idor-playbook'])

    const merged = await listKbAction('demo')
    expect(merged.ok && merged.data.map((e) => [e.slug, e.scope])).toEqual([
      ['idor-playbook', 'global'],
      ['solo-demo', 'project'],
    ])

    const bad = await listKbAction('no-existe')
    expect(bad).toMatchObject({ ok: false, error: expect.stringMatching(/No existe el proyecto/) })
  })
})

describe('createKbAction / updateKbAction (ambos ámbitos, errores propagados)', () => {
  it('crea en global y en proyecto; colisión en el mismo ámbito → error claro', async () => {
    const g = await createKbAction(ENTRY, 'global')
    expect(g.ok).toBe(true)
    if (g.ok) {
      expect(g.data.slug).toBe('idor-playbook')
      expect(existsSync(join(env.root, '.config/kb/idor-playbook/SKILL.md'))).toBe(true)
    }
    const p = await createKbAction({ ...ENTRY, name: 'report-idor', category: 'reporte' }, 'demo')
    expect(p.ok).toBe(true)
    if (p.ok) expect(existsSync(join(env.root, 'demo/.config/kb/report-idor/SKILL.md'))).toBe(true)

    const dup = await createKbAction({ ...ENTRY, body: 'otro' }, 'global')
    expect(dup).toMatchObject({ ok: false, error: expect.stringMatching(/Ya existe.*idor-playbook/) })
  })

  it('scope de creación inexistente → rechazado antes de escribir nada', async () => {
    const res = await createKbAction({ ...ENTRY, name: 'intruso' }, 'no-existe')
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/No existe el proyecto/) })
    expect(existsSync(join(env.root, 'no-existe'))).toBe(false)
  })

  it('edita contenido y descripción; rename a slug ocupado → colisión; inexistente → not found', async () => {
    await createKbAction(ENTRY, 'global')
    await createKbAction({ ...ENTRY, name: 'otra-entrada' }, 'global')

    const edited = await updateKbAction('idor-playbook', { description: 'nueva descripción' }, 'global')
    expect(edited.ok).toBe(true)

    const renamed = await updateKbAction('otra-entrada', { name: 'idor-playbook' }, 'global')
    expect(renamed).toMatchObject({ ok: false, error: expect.stringMatching(/Ya existe/) })

    const ghost = await updateKbAction('fantasma', { body: 'x' }, 'global')
    expect(ghost).toMatchObject({ ok: false, error: expect.stringMatching(/No existe ninguna entrada/) })

    // scope de edición inexistente → rechazado
    const badScope = await updateKbAction('idor-playbook', { body: 'x' }, 'no-existe')
    expect(badScope).toMatchObject({ ok: false, error: expect.stringMatching(/No existe el proyecto/) })
  })
})

describe('deleteKbAction (a .trash) y loadKbEntryAction', () => {
  it('borra (primero true, luego false) y deja el dir en .trash; carga trae cuerpo y references', async () => {
    await createKbAction(ENTRY, 'global')
    const refs = join(env.root, '.config/kb/idor-playbook/references')
    mkdirSync(refs, { recursive: true })
    writeFileSync(join(refs, 'payloads.txt'), "' OR 1=1")

    const loaded = await loadKbEntryAction('idor-playbook')
    expect(loaded.ok && loaded.data.body).toBe('## Pasos\n')
    expect(loaded.ok && loaded.data.references).toEqual(['payloads.txt'])

    const ref = await readKbReferenceAction('idor-playbook', 'payloads.txt')
    expect(ref.ok && ref.data.content).toBe("' OR 1=1")

    const del = await deleteKbAction('idor-playbook', 'global')
    expect(del.ok && del.data.deleted).toBe(true)
    expect(existsSync(join(env.root, '.config/kb/idor-playbook'))).toBe(false)
    const trash = readdirSync(join(env.root, '.trash'))
    expect(trash.some((d) => d.endsWith('-idor-playbook'))).toBe(true)

    const delAgain = await deleteKbAction('idor-playbook', 'global')
    expect(delAgain.ok && delAgain.data.deleted).toBe(false)

    const ghost = await loadKbEntryAction('fantasma')
    expect(ghost).toMatchObject({ ok: false, error: expect.stringMatching(/No existe/) })
  })
})

describe('promoteToKbAction (feedback loop 08c: SOLO acción humana)', () => {
  const PAYLOAD = {
    title: 'sqli-users-endpoint',
    body: '## Primitiva confirmada\n\nGET /api/v1/users con id secuencial: BOLA verificada manualmente.',
    category: 'tecnica' as const,
    tags: ['sqli'],
    source: 'finding',
    sourceRef: 'finding:sql-injection@api.ejemplo.com',
  }

  it('antes de promover la KB está vacía; el único camino es la acción explícita', async () => {
    expect(await listKbAction()).toMatchObject({ ok: true, data: [] })
    expect(await listKbAction('demo')).toMatchObject({ ok: true, data: [] })
  })

  it('promover crea la entrada con scope/categoría/tags/cuerpo y trazabilidad', async () => {
    const res = await promoteToKbAction('demo', PAYLOAD, 'demo')
    expect(res.ok).toBe(true)
    const loaded = loadKbEntry(res.ok ? res.data.slug : '', { project: 'demo', root: env.root })
    expect(loaded.slug).toBe('sqli-users-endpoint')
    expect(loaded.category).toBe('tecnica')
    expect(loaded.tags).toContain('promovido')
    expect(loaded.tags).toContain('origen:finding')
    expect(loaded.tags).toContain('sqli')
    expect(loaded.body).toContain('Promovido a KB manualmente (08c)')
    expect(loaded.body).toContain('finding:sql-injection@api.ejemplo.com')
    expect(loaded.body).toContain('BOLA verificada manualmente')
  })

  it('colisión de slug → sufijo automático (promover dos veces no es error)', async () => {
    const first = await promoteToKbAction('demo', PAYLOAD, 'demo')
    const second = await promoteToKbAction('demo', PAYLOAD, 'demo')
    expect(first.ok && second.ok).toBe(true)
    expect(second.ok && second.data.slug).toBe('sqli-users-endpoint-2')
    const idx = await listKbAction('demo')
    expect(idx.ok && idx.data).toHaveLength(2)
  })

  it('scope global también funciona; scope inexistente y payload vacío → error', async () => {
    const g = await promoteToKbAction('demo', { ...PAYLOAD, title: 'global-entry' }, 'global')
    expect(g.ok).toBe(true)
    const badScope = await promoteToKbAction('demo', { ...PAYLOAD, title: 'x-1' }, 'no-existe')
    expect(badScope).toMatchObject({ ok: false, error: expect.stringMatching(/No existe el proyecto/) })
    const empty = await promoteToKbAction('demo', { ...PAYLOAD, title: '', body: '' }, 'demo')
    expect(empty).toMatchObject({ ok: false, error: expect.stringMatching(/vacía/) })
  })

  it('tras promover (y reindexar), searchKbAction la encuentra', async () => {
    process.env.DB_PATH = join(env.root, 'index.db')
    await promoteToKbAction('demo', { ...PAYLOAD, body: 'Marcador unico para FTS-SEARCH-08C' }, 'demo')
    const res = await searchKbAction('FTS-SEARCH-08C', { project: 'demo', category: 'tecnica' })
    expect(res.ok).toBe(true)
    expect(res.ok && res.data.map((h) => h.slug)).toContain('sqli-users-endpoint')
    delete process.env.DB_PATH
  })
})
