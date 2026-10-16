import { describe, expect, it } from 'vitest'
import { diffReconRuns, extractReconItems, isDiffableTool } from './diff'

describe('diffReconRuns (nuevo / desaparecido / sin cambios)', () => {
  it('marca lo nuevo conservando el orden del run actual', () => {
    const prev = ['a.ejemplo.com', 'b.ejemplo.com']
    const cur = ['b.ejemplo.com', 'c.ejemplo.com', 'd.ejemplo.com']
    expect(diffReconRuns(prev, cur)).toEqual({
      added: ['c.ejemplo.com', 'd.ejemplo.com'],
      removed: ['a.ejemplo.com'],
      unchanged: ['b.ejemplo.com'],
    })
  })

  it('primer run (anterior vacío): todo es nuevo', () => {
    expect(diffReconRuns([], ['a.com', 'b.com'])).toEqual({
      added: ['a.com', 'b.com'],
      removed: [],
      unchanged: [],
    })
  })

  it('sin cambios: nada nuevo ni desaparecido', () => {
    expect(diffReconRuns(['a.com', 'b.com'], ['a.com', 'b.com'])).toEqual({
      added: [],
      removed: [],
      unchanged: ['a.com', 'b.com'],
    })
  })
})

describe('extractReconItems (según la herramienta)', () => {
  it('subfinder/dnsx: un host por línea', () => {
    const out = 'api.ejemplo.com\napp.ejemplo.com\n\n'
    expect(extractReconItems('subfinder', out)).toEqual(['api.ejemplo.com', 'app.ejemplo.com'])
    expect(extractReconItems('dnsx', out)).toEqual(['api.ejemplo.com', 'app.ejemplo.com'])
  })

  it('httpx: hosts desde URLs, únicos (reutiliza parseHttpxHosts)', () => {
    const out = 'https://app.ejemplo.com/login\nhttp://app.ejemplo.com\nhttps://api.ejemplo.com'
    expect(extractReconItems('httpx', out)).toEqual(['app.ejemplo.com', 'api.ejemplo.com'])
  })

  it('gau/katana: URLs http(s), caja preservada, únicas', () => {
    const out = 'https://ejemplo.com/A\nhttps://ejemplo.com/A\nhttp://ejemplo.com/b\nbasura\n-oN /etc/passwd'
    expect(extractReconItems('gau', out)).toEqual(['https://ejemplo.com/A', 'http://ejemplo.com/b'])
  })

  it('herramientas no diffeables → null', () => {
    expect(extractReconItems('nmap', 'puerto 80 abierto')).toBeNull()
    expect(extractReconItems('nuclei', '[info] algo')).toBeNull()
    expect(extractReconItems('gf', 'x')).toBeNull()
  })
})

describe('isDiffableTool', () => {
  it('hosts y URLs sí; activas/explotación no', () => {
    expect(isDiffableTool('subfinder')).toBe(true)
    expect(isDiffableTool('httpx')).toBe(true)
    expect(isDiffableTool('katana')).toBe(true)
    expect(isDiffableTool('nmap')).toBe(false)
    expect(isDiffableTool('sqlmap')).toBe(false)
  })
})
