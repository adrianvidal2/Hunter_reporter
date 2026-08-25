import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFixture, type Fixture } from '../../test/fixtures/fixture'
import { sha256File } from './hash'
import { createWatcher, type WatchEvent } from './watcher'

/** Espera (con tope) a que `cond` sea verdad. */
async function waitFor(cond: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timeout')
    await new Promise((r) => setTimeout(r, 50))
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('createWatcher (chokidar + awaitWriteFinish)', () => {
  let fx: Fixture
  let events: WatchEvent[]
  let close: (() => Promise<void>) | null = null

  beforeEach(async () => {
    fx = createFixture()
    events = []
    const watcher = createWatcher(fx.root, (e) => events.push(e))
    close = () => watcher.close()
    await watcher.ready
  })

  afterEach(async () => {
    await close?.()
    fx.cleanup()
  })

  it('6.1: cp de un .md → UN solo evento, con relPath y hash correctos', async () => {
    const dst = path.join(fx.draftsDir, 'nuevo-copiado.md')
    copyFileSync(fx.mdFrontMatter, dst) // el "cp" del plan

    await waitFor(() => events.some((e) => e.relPath.endsWith('nuevo-copiado.md')))
    await sleep(600) // ventana para cazar duplicados/ráfagas

    const forFile = events.filter((e) => e.relPath === 'demo_project/reportes/nuevo-copiado.md')
    expect(forFile).toHaveLength(1) // ni ráfaga ni add+change
    expect(forFile[0]!.type).toBe('add')
    expect(forFile[0]!.hash).toBe(sha256File(dst))
  })

  it('ignora .tmp, .trash, .history, .cache, .config y artefactos SQLite (.db/.db-wal/.db-shm)', async () => {
    writeFileSync(path.join(fx.draftsDir, '.atomic.md.tmp'), 'tmp de writeAtomic')
    mkdirSync(path.join(fx.root, '.trash'), { recursive: true })
    writeFileSync(path.join(fx.root, '.trash', 'borrado.md'), 'x')
    mkdirSync(path.join(fx.root, '.history/demo_project/reportes'), { recursive: true })
    writeFileSync(path.join(fx.root, '.history/demo_project/reportes/informe.md'), 'x')
    mkdirSync(path.join(fx.root, '.cache'), { recursive: true })
    writeFileSync(path.join(fx.root, '.cache', 'algo.md'), 'x')
    // plantillas dentro del árbol vigilado (7.1): editar una NO puede
    // aparecer como reporte pendiente
    mkdirSync(path.join(fx.root, '.config/templates'), { recursive: true })
    writeFileSync(path.join(fx.root, '.config/templates/ywh.md'), '# Plantilla')
    writeFileSync(path.join(fx.root, '.config/templates/ywh.md'), '# Plantilla editada')
    // índice SQLite dentro del árbol vigilado (como en los tests): silencio
    writeFileSync(path.join(fx.root, 'index.db'), 'sqlite')
    writeFileSync(path.join(fx.root, 'index.db-wal'), 'wal')
    writeFileSync(path.join(fx.root, 'index.db-shm'), 'shm')

    await sleep(800) // más que stabilityThreshold + margen
    expect(events).toHaveLength(0)

    // un cambio real en un borrador sí dispara (type: change)
    writeFileSync(fx.mdPlain, 'contenido reescrito')
    await waitFor(() => events.some((e) => e.relPath === 'demo_project/reportes/borrador-sqli.md'))
    expect(events.find((e) => e.relPath === 'demo_project/reportes/borrador-sqli.md')!.type).toBe(
      'change',
    )
  })

  it('regresión: el root llamándose "reportes" no anula el filtro (casa real del usuario)', async () => {
    // fixture manual con basename 'reportes' — exactamente la situación real
    const base = mkdtempSync(path.join(tmpdir(), 'reporter-root-'))
    const root = path.join(base, 'reportes')
    mkdirSync(path.join(root, 'proj', 'reportes'), { recursive: true })
    mkdirSync(path.join(root, 'proj', 'recon'), { recursive: true })
    mkdirSync(path.join(root, '_inbox'), { recursive: true })

    const events: string[] = []
    const watcher = createWatcher(root, (e) => events.push(e.relPath))
    await watcher.ready

    writeFileSync(path.join(root, 'proj', 'recon', 'notas.md'), '# recon')
    writeFileSync(path.join(root, 'suelto.md'), '# suelto')
    writeFileSync(path.join(root, 'proj', 'reportes', 'informe.md'), '# informe')
    writeFileSync(path.join(root, '_inbox', 'entrante.md'), '# entrante')

    await waitFor(() => events.length >= 2)
    await sleep(600)
    expect(events.sort()).toEqual([
      '_inbox/entrante.md',
      'proj/reportes/informe.md', // el segmento 'reportes' INTERNO sí cuenta
    ])
    await watcher.close()
    rmSync(base, { recursive: true, force: true })
  })

  it('aclaración bloque 9: solo <proyecto>/reportes/ y _inbox/ emiten; recon/notas/REPORTES_YWH/raíces → CERO eventos', async () => {
    // _inbox creado ANTES del arranque del watcher (chokidar no explora
    // directorios ignorados a posteriori)
    mkdirSync(path.join(fx.root, '_inbox'), { recursive: true })
    await close?.()
    events = []
    const watcher = createWatcher(fx.root, (e) => events.push(e))
    close = () => watcher.close()
    await watcher.ready

    mkdirSync(path.join(fx.root, 'demo_project', 'recon'), { recursive: true })
    mkdirSync(path.join(fx.root, 'demo_project', 'notas'), { recursive: true })
    writeFileSync(path.join(fx.root, 'demo_project', 'recon', 'notas-recon.md'), '# recon')
    writeFileSync(path.join(fx.root, 'demo_project', 'notas', 'apuntes.md'), '# apuntes')
    writeFileSync(path.join(fx.root, 'demo_project', 'README-proyecto.md'), '# readme')
    writeFileSync(path.join(fx.root, 'suelto.md'), '# suelto')
    writeFileSync(path.join(fx.deliveredDir, 'nuevo.pdf'), '%PDF-1.4')

    await sleep(800)
    expect(events).toHaveLength(0) // recon/, notas/, raíces y REPORTES_YWH: silencio total

    // y lo vigilado sigue funcionando: reportes/ y _inbox/ sí emiten
    writeFileSync(path.join(fx.root, '_inbox', 'entrante.md'), '# entrante')
    writeFileSync(path.join(fx.draftsDir, 'otro-borrador.md'), '# borrador')
    await waitFor(() => events.length >= 2)
    const rels = events.map((e) => e.relPath).sort()
    expect(rels).toEqual(['_inbox/entrante.md', 'demo_project/reportes/otro-borrador.md'])
  })

  it('9.6 ampliado: pentest/ (programa.md/json) NO genera eventos', async () => {
    mkdirSync(path.join(fx.root, 'demo_project', 'pentest'), { recursive: true })
    writeFileSync(path.join(fx.root, 'demo_project', 'pentest', 'programa.md'), '# programa')
    writeFileSync(path.join(fx.root, 'demo_project', 'pentest', 'programa.json'), '{}')
    writeFileSync(path.join(fx.root, 'demo_project', 'pentest', '.tmp-x.md.tmp'), 'tmp')

    await sleep(800)
    expect(events).toHaveLength(0)
  })
})
