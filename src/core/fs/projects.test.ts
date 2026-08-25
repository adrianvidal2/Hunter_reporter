import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFixture } from '../../test/fixtures/fixture'
import {
  InvalidProjectNameError,
  createProject,
  ensureInbox,
  projectStructureExists,
} from './projects'
import { listProject, listProjects } from './tree'
import type { WatchEvent } from './watcher'
import { createWatcher } from './watcher'

describe('createProject', () => {
  it('crea el directorio con sus dos subcarpetas y es usable por listProject', () => {
    const fx = createFixture()
    try {
      const dir = createProject('shop_demo', fx.root)

      expect(statSync(dir).isDirectory()).toBe(true)
      expect(statSync(path.join(dir, 'REPORTES_YWH')).isDirectory()).toBe(true)
      expect(statSync(path.join(dir, 'reportes')).isDirectory()).toBe(true)

      // Visible para listProjects y listProject (vacío pero sin errores)
      expect(listProjects(fx.root)).toContain('shop_demo')
      expect(listProject('shop_demo', fx.root)).toEqual({
        project: 'shop_demo',
        delivered: [],
        drafts: [],
      })
    } finally {
      fx.cleanup()
    }
  })

  it('rechaza nombres inválidos', () => {
    const fx = createFixture()
    try {
      const invalid = ['a/b', 'a\\b', '..', '.oculto', '_inbox', '', ' ', 'a\0b', 'x'.repeat(300)]
      for (const name of invalid) {
        expect(() => createProject(name, fx.root), JSON.stringify(name)).toThrow(
          InvalidProjectNameError,
        )
      }
      expect(listProjects(fx.root)).toEqual(['demo_project']) // nada se creó
    } finally {
      fx.cleanup()
    }
  })

  it('proyecto duplicado: idempotente (no rompe) y projectStructureExists lo detecta', () => {
    const fx = createFixture()
    try {
      expect(projectStructureExists('demo_project', fx.root)).toBe(true)
      const dir = createProject('demo_project', fx.root) // no lanza: idempotente
      expect(existsSync(fx.deliveredDir)).toBe(true)
      expect(existsSync(fx.draftsDir)).toBe(true)
      expect(readdirSync(fx.draftsDir)).toHaveLength(2) // los 2 borradores intactos
      // el proyecto creado fresco NO tiene estructura completa aún
      createProject('shop_demo', fx.root)
      expect(projectStructureExists('shop_demo', fx.root)).toBe(true)
    } finally {
      fx.cleanup()
    }
  })

  it('aclaración bloque 9: directorio existente con OTRAS carpetas → solo crea las dos que faltan y no toca nada más', () => {
    const fx = createFixture()
    try {
      const base = path.join(fx.root, 'recon-target')
      mkdirSync(path.join(base, 'recon', 'sub'), { recursive: true })
      mkdirSync(path.join(base, 'notas'), { recursive: true })
      writeFileSync(path.join(base, 'recon', 'sub', 'datos.txt'), 'recon previo')
      writeFileSync(path.join(base, 'notas', 'apuntes.md'), '# apuntes previos')
      mkdirSync(path.join(base, 'reportes')) // ya existe una de las dos

      const dir = createProject('recon-target', fx.root)

      expect(existsSync(path.join(dir, 'REPORTES_YWH'))).toBe(true) // la que faltaba
      expect(existsSync(path.join(dir, 'reportes'))).toBe(true)
      // lo demás INTACTO
      expect(readFileSync(path.join(base, 'recon', 'sub', 'datos.txt'), 'utf8')).toBe('recon previo')
      expect(readFileSync(path.join(base, 'notas', 'apuntes.md'), 'utf8')).toBe('# apuntes previos')
      // y las dos existentes siguen vacías (no mete nada dentro)
      expect(readdirSync(path.join(dir, 'reportes'))).toEqual([])
    } finally {
      fx.cleanup()
    }
  })
})

describe('createProject + watcher: carpetas extra del proyecto no generan pendientes', () => {
  it('crear proyecto desde 9.6 con carpetas propias del usuario: el watcher calla', async () => {
    const fx = createFixture()
    try {
      const events: WatchEvent[] = []
      const watcher = createWatcher(fx.root, (e) => events.push(e))
      await watcher.ready

      createProject('nuevo-desde-ywh', fx.root)
      // carpetas propias del usuario tras crear el proyecto
      mkdirSync(path.join(fx.root, 'nuevo-desde-ywh', 'scripts'), { recursive: true })
      writeFileSync(path.join(fx.root, 'nuevo-desde-ywh', 'scripts', 'recon.sh'), '#!/bin/sh')
      writeFileSync(path.join(fx.root, 'nuevo-desde-ywh', 'reportes', 'primer-borrador.md'), '# hola')

      await new Promise((r) => setTimeout(r, 900))
      const rels = events.map((e) => e.relPath)
      expect(rels).toEqual(['nuevo-desde-ywh/reportes/primer-borrador.md']) // solo reportes/
      await watcher.close()
    } finally {
      fx.cleanup()
    }
  })
})

describe('ensureInbox', () => {
  it('crea _inbox si no existe, es idempotente, y sigue oculto para listProjects', () => {
    const fx = createFixture()
    try {
      expect(existsSync(path.join(fx.root, '_inbox'))).toBe(false)

      const inbox = ensureInbox(fx.root)
      expect(statSync(inbox).isDirectory()).toBe(true)

      // Idempotente: llamarlo otra vez no falla ni devuelve otra ruta
      expect(ensureInbox(fx.root)).toBe(inbox)

      // _inbox no aparece como proyecto
      expect(listProjects(fx.root)).toEqual(['demo_project'])
    } finally {
      fx.cleanup()
    }
  })
})
