import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFixture } from '../test/fixtures/fixture'

// El root que verá getEnv() cambia por test: no podemos usar el getEnv real
// (memoizado), así que mockeamos el módulo con un valor mutable.
const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ REPORTS_ROOT: env.root }),
}))
// revalidatePath solo existe dentro del runtime de Next
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { createProjectAction, saveFileAction, approvePendingAction, discardPendingAction, deleteProjectAction } from './actions'
import { listProjects } from '@/core/fs/tree'

// Fixture con un segundo proyecto listo para recibir movimientos
function createTwoProjectFixture() {
  const fx = createFixture({ extraProjects: ['banco_demo'] })
  mkdirSync(path.join(fx.root, 'banco_demo', 'reportes'), { recursive: true })
  mkdirSync(path.join(fx.root, 'banco_demo', 'REPORTES_YWH'), { recursive: true })
  return fx
}

describe('createProjectAction', () => {
  let fx: ReturnType<typeof createFixture>

  beforeEach(() => {
    fx = createFixture()
    env.root = fx.root
    return () => fx.cleanup()
  })

  const submit = (name: string) => {
    const fd = new FormData()
    fd.set('name', name)
    return createProjectAction({ ok: false }, fd)
  }

  it('crea el proyecto con sus dos subcarpetas y devuelve ok', async () => {
    const res = await submit('shop_demo')
    expect(res).toEqual({ ok: true, created: 'shop_demo' })
    expect(existsSync(path.join(fx.root, 'shop_demo', 'REPORTES_YWH'))).toBe(true)
    expect(existsSync(path.join(fx.root, 'shop_demo', 'reportes'))).toBe(true)
  })

  it("'../x' y otros nombres inválidos → error legible y nada creado", async () => {
    for (const bad of ['../x', 'a/b', '.oculto', '_inbox', '']) {
      const res = await submit(bad)
      expect(res.ok, JSON.stringify(bad)).toBe(false)
      expect(res.error).toBeTruthy()
    }
    // Solo sigue existiendo el proyecto del fixture
    expect((await import('@/core/fs/tree')).listProjects(fx.root)).toEqual(['demo_project'])
  })

  it('duplicado → ok con estructura intacta (idempotente, aclaración bloque 9)', async () => {
    const res = await submit('demo_project')
    expect(res.ok).toBe(true) // no rompe: solo crea lo que falte (nada)
    const drafts = readdirSync(path.join(fx.root, 'demo_project', 'reportes'))
    expect(drafts.sort()).toEqual(['borrador-sqli.md', 'informe-idor.md']) // intactos
  })
})

describe('moveFileAction', () => {
  let fx: ReturnType<typeof createTwoProjectFixture>

  beforeEach(() => {
    fx = createTwoProjectFixture()
    env.root = fx.root
    return () => fx.cleanup()
  })

  it('mueve un .md a reportes/ del proyecto destino (y desaparece del origen)', async () => {
    const { moveFileAction } = await import('./actions')
    const res = await moveFileAction('demo_project/reportes/borrador-sqli.md', 'banco_demo')
    expect(res).toEqual({ ok: true })
    const dst = path.join(fx.root, 'banco_demo', 'reportes', 'borrador-sqli.md')
    expect(existsSync(dst)).toBe(true)
    expect(readFileSync(dst, 'utf8')).toContain('SQLi')
    expect(existsSync(fx.mdPlain)).toBe(false)
  })

  it('mueve un .pdf a REPORTES_YWH/ del proyecto destino', async () => {
    const { moveFileAction } = await import('./actions')
    const res = await moveFileAction('demo_project/REPORTES_YWH/informe-xss-reflejado.pdf', 'banco_demo')
    expect(res).toEqual({ ok: true })
    expect(
      existsSync(path.join(fx.root, 'banco_demo', 'REPORTES_YWH', 'informe-xss-reflejado.pdf')),
    ).toBe(true)
    expect(existsSync(fx.pdf)).toBe(false)
  })

  it('proyecto destino inexistente → error y nada se mueve', async () => {
    const { moveFileAction } = await import('./actions')
    const res = await moveFileAction('demo_project/reportes/borrador-sqli.md', 'fantasma')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/no existe/i)
    expect(existsSync(fx.mdPlain)).toBe(true)
  })

  it('conflicto de nombre → error, destino intacto y origen sigue ahí', async () => {
    const { moveFileAction } = await import('./actions')
    const occupied = path.join(fx.root, 'banco_demo', 'reportes', 'borrador-sqli.md')
    writeFileSync(occupied, 'contenido previo del destino')

    const res = await moveFileAction('demo_project/reportes/borrador-sqli.md', 'banco_demo')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/ya existe/i)
    expect(readFileSync(occupied, 'utf8')).toBe('contenido previo del destino')
    expect(existsSync(fx.mdPlain)).toBe(true)
  })
})

describe('deleteFileAction', () => {
  let fx: ReturnType<typeof createFixture>

  beforeEach(() => {
    fx = createFixture()
    env.root = fx.root
    return () => fx.cleanup()
  })

  it('elimina → aparece en .trash/ con su contenido, sin unlink', async () => {
    const { deleteFileAction } = await import('./actions')
    const original = readFileSync(fx.mdFrontMatter, 'utf8')

    const res = await deleteFileAction('demo_project/reportes/informe-idor.md')
    expect(res).toEqual({ ok: true })
    expect(existsSync(fx.mdFrontMatter)).toBe(false)

    const trash = path.join(fx.root, '.trash')
    const entries = readdirSync(trash)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatch(/informe-idor\.md$/)
    expect(readFileSync(path.join(trash, entries[0]!), 'utf8')).toBe(original)
  })

  it('fichero inexistente → error legible', async () => {
    const { deleteFileAction } = await import('./actions')
    const res = await deleteFileAction('demo_project/reportes/no-existe.md')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/ya no existe/i)
  })
})

describe('saveFileAction', () => {
  let fx: ReturnType<typeof createFixture>

  beforeEach(() => {
    fx = createFixture()
    env.root = fx.root
    return () => fx.cleanup()
  })

  it('guarda el contenido editado en el borrador (escritura real con writeAtomic)', async () => {
    const res = await saveFileAction('demo_project/reportes/informe-idor.md', '---\ntitle: Editado\n---\n\nContenido nuevo.')
    expect(res.ok).toBe(true)
    expect(readFileSync(fx.mdFrontMatter, 'utf8')).toContain('Contenido nuevo.')
    // Sin .tmp residuales del writeAtomic
    expect(readdirSync(fx.draftsDir).filter((f) => f.includes('.tmp'))).toHaveLength(0)
  })

  it('rechaza rutas que no son borradores .md de reportes/', async () => {
    const pdf = await saveFileAction('demo_project/REPORTES_YWH/informe-xss-reflejado.pdf', 'x')
    expect(pdf.ok).toBe(false)
    expect(pdf.error).toMatch(/solo se guardan/i)

    const escape = await saveFileAction('../fuera.md', 'x')
    expect(escape.ok).toBe(false)

    // El PDF original queda intacto
    expect(existsSync(fx.pdf)).toBe(true)
  })

  it('4.7 ⚠️ fichero tocado por detrás → avisa (conflict) y NO sobrescribe', async () => {
    const baseline = Math.round(statSync(fx.mdFrontMatter).mtimeMs)

    // Alguien edita el fichero fuera del editor (mtime cambia)
    writeFileSync(fx.mdFrontMatter, 'versión escrita por otro proceso')
    // utimesSync explícito: sin depender de la granularidad de ms del fs
    const later = Date.now() + 10_000
    utimesSync(fx.mdFrontMatter, later, later)

    const res = await saveFileAction('demo_project/reportes/informe-idor.md', 'mi edición del editor', baseline)
    expect(res.ok).toBe(false)
    expect(res.conflict).toBe(true)
    expect(res.error).toMatch(/cambió fuera del editor/i)
    // El disco conserva la versión externa: nada se perdió
    expect(readFileSync(fx.mdFrontMatter, 'utf8')).toBe('versión escrita por otro proceso')

    // Un simple touch (mtime sin cambio de contenido) también avisa
    const now = Date.now()
    utimesSync(fx.mdFrontMatter, now, now + 5000)
    const touched = await saveFileAction(
      'demo_project/reportes/informe-idor.md',
      'mi edición',
      Math.round(statSync(fx.mdFrontMatter).mtimeMs) - 5000,
    )
    expect(touched.conflict).toBe(true)
    expect(readFileSync(fx.mdFrontMatter, 'utf8')).toBe('versión escrita por otro proceso')
  })

  it('guardar con el mtime vigente actualiza la línea base (res.mtimeMs)', async () => {
    const baseline = Math.round(statSync(fx.mdFrontMatter).mtimeMs)
    const res = await saveFileAction('demo_project/reportes/informe-idor.md', 'edición legítima', baseline)
    expect(res.ok).toBe(true)
    expect(res.mtimeMs).toBe(Math.round(statSync(fx.mdFrontMatter).mtimeMs))
    expect(readFileSync(fx.mdFrontMatter, 'utf8')).toBe('edición legítima')

    // Guardar otra vez usando la nueva línea base también funciona
    const second = await saveFileAction('demo_project/reportes/informe-idor.md', 'segunda edición', res.mtimeMs)
    expect(second.ok).toBe(true)
  })

  it('4.8: 25 guardados → quedan 20 copias en .history, las más recientes', async () => {
    const dir = path.join(fx.root, '.history/demo_project/reportes/informe-idor.md')

    for (let i = 1; i <= 25; i++) {
      const baseline = Math.round(statSync(fx.mdFrontMatter).mtimeMs)
      const res = await saveFileAction('demo_project/reportes/informe-idor.md', `versión ${i}`, baseline)
      expect(res.ok, `guardado ${i}`).toBe(true)
    }

    const entries = readdirSync(dir).sort()
    expect(entries).toHaveLength(20)
    // Cada guardado archiva el contenido ANTERIOR: la última copia es la v24
    // (previa al guardado 25) y la más vieja retenida, la v5
    expect(readFileSync(path.join(dir, entries.at(-1)!), 'utf8')).toBe('versión 24')
    expect(readFileSync(path.join(dir, entries[0]!), 'utf8')).toBe('versión 5')
  })

  it('fichero borrado por detrás → error legible sin conflicto', async () => {
    const baseline = Math.round(statSync(fx.mdFrontMatter).mtimeMs)
    rmSync(fx.mdFrontMatter)
    const res = await saveFileAction('demo_project/reportes/informe-idor.md', 'x', baseline)
    expect(res.ok).toBe(false)
    expect(res.conflict).toBeUndefined()
    expect(res.error).toMatch(/ya no existe/i)
  })
})

describe('approve/discard pending (6.4/6.5)', () => {
  let fx: ReturnType<typeof createFixture>

  beforeEach(() => {
    fx = createFixture()
    env.root = fx.root
    process.env.DB_PATH = path.join(fx.root, 'index.db')
    return () => {
      fx.cleanup()
      delete process.env.DB_PATH
    }
  })

  it('aprobar marca approved y devuelve nota de que el LLM llega en el bloque 8', async () => {
    const { registerPending, getPendingAction } = await import('@/db/pending')
    registerPending(
      { path: 'demo_project/reportes/nuevo.md', hash: 'h', size: 1, mtimeMs: 1 },
      path.join(fx.root, 'index.db'),
    )

    const res = await approvePendingAction('demo_project/reportes/nuevo.md')
    expect(res.ok).toBe(true)
    expect(res.note).toMatch(/bloque 8/)
    expect(getPendingAction('demo_project/reportes/nuevo.md')!.status).toBe('approved')
  })

  it('descartar marca discarded y cierra el flujo (re-aprobar ya no procede)', async () => {
    const { registerPending, getPendingAction } = await import('@/db/pending')
    registerPending(
      { path: 'demo_project/reportes/otro.md', hash: 'h', size: 1, mtimeMs: 1 },
      path.join(fx.root, 'index.db'),
    )

    const res = await discardPendingAction('demo_project/reportes/otro.md')
    expect(res).toEqual({ ok: true })
    expect(getPendingAction('demo_project/reportes/otro.md')!.status).toBe('discarded')
  })

  it('path que no está pendiente → error legible', async () => {
    const res = await discardPendingAction('demo_project/reportes/inexistente.md')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/ya no está pendiente/i)
  })
})

describe('deleteProjectAction (eliminar proyecto → .trash/)', () => {
  let fx: ReturnType<typeof createFixture>

  beforeEach(() => {
    fx = createFixture({ extraProjects: ['otro_proyecto'] })
    // crear la estructura del segundo proyecto (solo el del que no se borra)
    mkdirSync(path.join(fx.root, 'otro_proyecto', 'reportes'), { recursive: true })
    mkdirSync(path.join(fx.root, 'otro_proyecto', 'REPORTES_YWH'), { recursive: true })
    env.root = fx.root
    return () => fx.cleanup()
  })

  it('mueve la carpeta ENTERA (con contenido) a .trash y desaparece de la lista', async () => {
    // el fixture ya crea borradores dentro de demo_project/reportes/
    const res = await deleteProjectAction('demo_project')
    expect(res.ok).toBe(true)

    // ya no está en la lista de proyectos
    expect(listProjects(fx.root)).not.toContain('demo_project')
    // no existe en su sitio original
    expect(existsSync(path.join(fx.root, 'demo_project'))).toBe(false)
    // está en .trash con el contenido (recuperable)
    const trashDirs = readdirSync(path.join(fx.root, '.trash'))
    expect(trashDirs.length).toBe(1)
    const trashed = path.join(fx.root, '.trash', trashDirs[0]!)
    expect(readdirSync(path.join(trashed, 'reportes'))).toHaveLength(2) // borradores del fixture
    expect(readdirSync(path.join(trashed, 'reportes'))).toContain('borrador-sqli.md')
  })

  it('borra SOLO el proyecto pedido; otros proyectos del mismo directorio quedan intactos', async () => {
    await deleteProjectAction('demo_project')

    expect(listProjects(fx.root)).toEqual(['otro_proyecto'])
    expect(existsSync(path.join(fx.root, 'otro_proyecto'))).toBe(true)
    expect(readdirSync(path.join(fx.root, '.trash'))).toHaveLength(1)
  })

  it('rechaza un nombre que no es un proyecto real (evita errores de dedo)', async () => {
    const res = await deleteProjectAction('no-existe')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/no es un proyecto/i)
    // nada se movió a .trash
    expect(existsSync(path.join(fx.root, '.trash'))).toBe(false)
  })
})
