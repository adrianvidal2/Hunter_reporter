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
  listKbAction,
  loadKbEntryAction,
  readKbReferenceAction,
  updateKbAction,
} from './actions'

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
