import { describe, expect, it } from 'vitest'
import { composeUrl, isValidUrlPath, parseCrawlerUrls, parseHttpxHosts } from './flows'

describe('parseHttpxHosts (hosts vivos desde la salida de httpx)', () => {
  it('extrae hosts únicos de URLs de httpx, en orden', () => {
    const out = [
      'https://app.ejemplo.com/login',
      'https://api.ejemplo.com/v1',
      'http://app.ejemplo.com', // repetido → único
      '',
      'dev.ejemplo.com:8080',
    ].join('\n')
    expect(parseHttpxHosts(out)).toEqual(['app.ejemplo.com', 'api.ejemplo.com', 'dev.ejemplo.com'])
  })

  it('líneas basura y flags disfrazados no pasan', () => {
    expect(parseHttpxHosts('-oN /etc/passwd\n\n  \nhttps://ok.com')).toEqual(['ok.com'])
  })
})

describe('parseCrawlerUrls (URLs de crawlers/archivadores/gf para el pipeline)', () => {
  it('líneas planas: únicas, en orden y con la caja preservada', () => {
    const out = ['https://ejemplo.com/a', 'https://ejemplo.com/a', 'http://ejemplo.com/B?x=1', ''].join('\n')
    expect(parseCrawlerUrls(out)).toEqual(['https://ejemplo.com/a', 'http://ejemplo.com/B?x=1'])
  })

  it('formatos de katana JSON (-jc) y gospider ([Get] [200] …)', () => {
    const katana = [
      '{"timestamp":"2026-01-01T10:00:00Z","method":"GET","url":"https://app.ejemplo.com/login"}',
      '{"method":"GET","url":"https://app.ejemplo.com/api/v1","tag":"a"}',
    ].join('\n')
    expect(parseCrawlerUrls(katana)).toEqual(['https://app.ejemplo.com/login', 'https://app.ejemplo.com/api/v1'])
    expect(parseCrawlerUrls('[Get] [200] https://app.ejemplo.com/y\n[Get] [404] https://app.ejemplo.com/z\n')).toEqual([
      'https://app.ejemplo.com/y',
      'https://app.ejemplo.com/z',
    ])
  })

  it('líneas basura y flags disfrazados fuera; vacío → []', () => {
    expect(parseCrawlerUrls('-oN /etc/passwd\n--dump\nbasura sin url\n  \n')).toEqual([])
    expect(parseCrawlerUrls('')).toEqual([])
  })

  it('hosts sin forma de dominio no pasan; puntuación final pegada se recorta', () => {
    expect(parseCrawlerUrls('https://\nhttps://x\n')).toEqual([])
    expect(parseCrawlerUrls('https://app.ejemplo.com/a.\n(https://app.ejemplo.com/b)')).toEqual([
      'https://app.ejemplo.com/a',
      'https://app.ejemplo.com/b',
    ])
  })
})

describe('isValidUrlPath / composeUrl (sqlmap/dalfox por URL)', () => {
  it('ruta válida: empieza por / o ?, sin espacios', () => {
    expect(isValidUrlPath('')).toBe(true)
    expect(isValidUrlPath('/admin/login?id=1')).toBe(true)
    expect(isValidUrlPath('?page=1')).toBe(true)
    expect(isValidUrlPath('admin')).toBe(false)
    expect(isValidUrlPath('/x y')).toBe(false)
    expect(isValidUrlPath('https://otro.com')).toBe(false)
    expect(isValidUrlPath('-dump')).toBe(false)
  })

  it('composeUrl: dominio → https://, URL → tal cual, con y sin ruta', () => {
    expect(composeUrl('api.ejemplo.com', '/admin')).toBe('https://api.ejemplo.com/admin')
    expect(composeUrl('https://app.ejemplo.com/login', '?id=1')).toBe('https://app.ejemplo.com/login?id=1')
    expect(composeUrl('api.ejemplo.com', '')).toBe('https://api.ejemplo.com')
    expect(() => composeUrl('api.ejemplo.com', 'sin-barra')).toThrow()
  })
})
