import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFixture } from '../../test/fixtures/fixture'
import { PathEscapeError } from './paths'
import { listProject, listProjects } from './tree'
import { sortFiles } from './sorting'

describe('listProjects', () => {
  it('lista los proyectos de primer nivel, ordenados (fixture de 2 proyectos)', () => {
    const fx = createFixture({ extraProjects: ['banco_demo'] })
    try {
      expect(listProjects(fx.root)).toEqual(['banco_demo', 'demo_project'])
    } finally {
      fx.cleanup()
    }
  })

  it('ignora _inbox, dotfiles, ficheros sueltos y symlinks en la raíz', () => {
    const fx = createFixture({ extraProjects: ['banco_demo'] })
    try {
      mkdirSync(path.join(fx.root, '_inbox'), { recursive: true })
      mkdirSync(path.join(fx.root, '.trash'), { recursive: true })
      mkdirSync(path.join(fx.root, '.cache'), { recursive: true })
      writeFileSync(path.join(fx.root, 'README.md'), 'no soy un proyecto')
      symlinkSync(fx.project, path.join(fx.root, 'enlace-al-proyecto'))

      expect(listProjects(fx.root)).toEqual(['banco_demo', 'demo_project'])
    } finally {
      fx.cleanup()
    }
  })
})

describe('listProject', () => {
  it('proyecto completo: PDFs en delivered, .md en drafts, con metadatos y orden natural', () => {
    const fx = createFixture()
    try {
      const listing = listProject('demo_project', fx.root)

      expect(listing.project).toBe('demo_project')
      expect(listing.delivered.map((f) => f.name)).toEqual(['informe-xss-reflejado.pdf'])
      expect(listing.drafts.map((f) => f.name)).toEqual(['borrador-sqli.md', 'informe-idor.md'])

      const pdf = listing.delivered[0]!
      expect(pdf.relPath).toBe('demo_project/REPORTES_YWH/informe-xss-reflejado.pdf')
      expect(pdf.size).toBeGreaterThan(100) // PDF válido, no un stub de 4 bytes
      expect(pdf.mtimeMs).toBeGreaterThan(0)

      // Orden natural: informe2 va antes que informe10
      writeFileSync(path.join(fx.draftsDir, 'informe10.md'), 'diez')
      writeFileSync(path.join(fx.draftsDir, 'informe2.md'), 'dos')
      expect(listProject('demo_project', fx.root).drafts.map((f) => f.name)).toEqual([
        'borrador-sqli.md',
        'informe-idor.md',
        'informe2.md',
        'informe10.md',
      ])
    } finally {
      fx.cleanup()
    }
  })

  it('proyecto al que le falta una (o las dos) carpetas: esa sección va vacía, no error', () => {
    const fx = createFixture()
    try {
      rmSync(fx.deliveredDir, { recursive: true })
      let listing = listProject('demo_project', fx.root)
      expect(listing.delivered).toEqual([])
      expect(listing.drafts.map((f) => f.name)).toEqual(['borrador-sqli.md', 'informe-idor.md'])

      rmSync(fx.draftsDir, { recursive: true })
      listing = listProject('demo_project', fx.root)
      expect(listing).toEqual({ project: 'demo_project', delivered: [], drafts: [] })
    } finally {
      fx.cleanup()
    }
  })

  it('rechaza nombres de proyecto con separadores, .. y byte nulo', () => {
    const fx = createFixture()
    try {
      expect(() => listProject('a/b', fx.root)).toThrow(PathEscapeError)
      expect(() => listProject('..\\otro', fx.root)).toThrow(PathEscapeError)
      expect(() => listProject('..', fx.root)).toThrow(PathEscapeError)
      expect(() => listProject('a\0b', fx.root)).toThrow(PathEscapeError)
    } finally {
      fx.cleanup()
    }
  })

  it('ordena con el MISMO naturalCompare que sortFiles (orden único de la app)', () => {
    const fx = createFixture()
    try {
      const mixed = ['Informe10.md', 'informe2.md', 'Zeta.md', 'alfa.md', 'IDOR.md']
      for (const n of mixed) writeFileSync(path.join(fx.draftsDir, n), 'x')

      const listing = listProject('demo_project', fx.root)
      expect(listing.drafts.map((f) => f.name)).toEqual(
        sortFiles(listing.drafts, 'name', 'asc').map((f) => f.name),
      )
    } finally {
      fx.cleanup()
    }
  })
})
