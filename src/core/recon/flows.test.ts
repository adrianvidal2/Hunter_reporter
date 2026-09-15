import { describe, expect, it } from 'vitest'
import { composeUrl, isValidUrlPath, parseHttpxHosts } from './flows'

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
