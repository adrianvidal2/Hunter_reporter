import { describe, expect, it } from 'vitest'
import type { FileEntry } from './tree'
import { filterFiles, naturalCompare, sortFiles } from './sorting'

const entry = (name: string, size: number, mtimeMs: number): FileEntry => ({
  name,
  relPath: `p/${name}`,
  size,
  mtimeMs,
})

describe('naturalCompare', () => {
  it('informe2 va antes que informe10 (numérico, no léxico)', () => {
    const shuffled = ['informe10.md', 'informe2.md', 'informe1.md']
    expect([...shuffled].sort(naturalCompare)).toEqual([
      'informe1.md',
      'informe2.md',
      'informe10.md',
    ])
  })
})

describe('sortFiles', () => {
  const files = [entry('informe10.md', 500, 300), entry('informe2.md', 100, 100), entry('a.md', 900, 200)]

  it('por nombre asc/desc aplica orden natural', () => {
    expect(sortFiles(files, 'name', 'asc').map((f) => f.name)).toEqual([
      'a.md',
      'informe2.md',
      'informe10.md',
    ])
    expect(sortFiles(files, 'name', 'desc').map((f) => f.name)).toEqual([
      'informe10.md',
      'informe2.md',
      'a.md',
    ])
  })

  it('por tamaño y por fecha, con desempate por nombre', () => {
    expect(sortFiles(files, 'size', 'asc').map((f) => f.name)).toEqual([
      'informe2.md',
      'informe10.md',
      'a.md',
    ])
    expect(sortFiles(files, 'date', 'desc').map((f) => f.name)).toEqual([
      'informe10.md',
      'a.md',
      'informe2.md',
    ])
  })
})

describe('filterFiles', () => {
  const files = [entry('Informe-XSS.md', 1, 1), entry('borrador-sqli.md', 1, 1), entry('idor.md', 1, 1)]

  it('busca por substring insensible a mayúsculas; query vacía lo devuelve todo', () => {
    expect(filterFiles(files, 'xss').map((f) => f.name)).toEqual(['Informe-XSS.md'])
    expect(filterFiles(files, '  SQLI ').map((f) => f.name)).toEqual(['borrador-sqli.md'])
    expect(filterFiles(files, '')).toHaveLength(3)
  })
})
