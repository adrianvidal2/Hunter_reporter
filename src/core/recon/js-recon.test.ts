import { describe, expect, it } from 'vitest'
import {
  parseSourcemap,
  reconstructFromSourcemap,
  resolveSourceMapping,
  safeSourceFileName,
  summarizeCoverage,
  type JsCoverageEntry,
} from './js-recon'

const MAP_OK = JSON.stringify({
  version: 3,
  file: 'app.min.js',
  sources: ['webpack:///./src/app.ts', './lib/util.ts'],
  sourcesContent: ['export const answer = 42\n', null],
  names: [],
})

describe('parseSourcemap (tolerante)', () => {
  it('map válido → sources + sourcesContent alineados; huecos → null', () => {
    const parsed = parseSourcemap(MAP_OK)
    expect(parsed?.sources).toEqual(['webpack:///./src/app.ts', './lib/util.ts'])
    expect(parsed?.sourcesContent).toEqual(['export const answer = 42\n', null])
  })

  it('JSON roto, sin sources, sources no-array o vacío → null', () => {
    expect(parseSourcemap('esto no es json')).toBeNull()
    expect(parseSourcemap('{"sources": 42}')).toBeNull()
    expect(parseSourcemap('{"sources": []}')).toBeNull() // sin nada utilizable
    expect(parseSourcemap('{"mappings":"AAAA"}')).toBeNull() // sin sources
  })

  it('tipos raros en sources (no-strings) se filtran sin romper', () => {
    const parsed = parseSourcemap('{"sources": ["ok.ts", 42, null, "otro.ts"]}')
    expect(parsed?.sources).toEqual(['ok.ts', 'otro.ts'])
    expect(parsed?.sourcesContent).toEqual([null, null])
  })
})

describe('resolveSourceMapping (inline data URI / remota / ninguna)', () => {
  it('//# sourceMappingURL remota → URL absoluta contra el JS', () => {
    const res = resolveSourceMapping(
      'https://objeto.ejemplo.com/static/js/app.min.js?v=2',
      'code();\n//# sourceMappingURL=app.min.js.map\n',
    )
    expect(res).toEqual({ kind: 'remote', url: 'https://objeto.ejemplo.com/static/js/app.min.js.map' })
  })

  it('data URI base64 → JSON inline decodificado; la última declaración manda', () => {
    const json = '{"sources":["a.ts"],"sourcesContent":["hola"]}'
    const b64 = Buffer.from(json).toString('base64')
    const body = `//# sourceMappingURL=mentira.map\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${b64}`
    expect(resolveSourceMapping('https://x.ejemplo.com/a.js', body)).toEqual({ kind: 'inline', json })
  })

  it('sin declaración, data URI rota o URL no resoluble → null (hueco)', () => {
    expect(resolveSourceMapping('https://x.ejemplo.com/a.js', 'var x = 1;')).toBeNull()
    expect(resolveSourceMapping('https://x.ejemplo.com/a.js', '//# sourceMappingURL=data:application/json;base64,%%%')).toBeNull()
    expect(resolveSourceMapping('no-es-url', '//# sourceMappingURL=../fuera.map')).toBeNull()
  })

  it('el legado //@ también se detecta', () => {
    const res = resolveSourceMapping('https://x.ejemplo.com/a.js', '//@ sourceMappingURL=a.js.map')
    expect(res).toEqual({ kind: 'remote', url: 'https://x.ejemplo.com/a.js.map' })
  })
})

describe('reconstructFromSourcemap (fuentes EXACTAS donde las hay)', () => {
  it('reconstruye byte a byte lo que trae sourcesContent; sin contenido → hueco marcado', () => {
    const rec = reconstructFromSourcemap(MAP_OK)
    expect(rec).not.toBeNull()
    expect(rec!.files).toHaveLength(2)
    expect(rec!.files[0]).toMatchObject({
      sourcePath: 'webpack:///./src/app.ts',
      content: 'export const answer = 42\n',
    })
    expect(rec!.files[1]!.content).toBeNull() // hueco honesto
    expect(rec!.withContent).toBe(1)
    expect(rec!.withoutContent).toBe(1)
  })

  it('map malformado → null (hueco map-invalid), nunca crash', () => {
    expect(reconstructFromSourcemap('{roto')).toBeNull()
    expect(reconstructFromSourcemap('')).toBeNull()
  })
})

describe('safeSourceFileName (nada sale del dir de salida)', () => {
  it('rutas normales se aplanan conservando los últimos segmentos', () => {
    expect(safeSourceFileName('src/app/main.ts')).toBe('src/app/main.ts')
    expect(safeSourceFileName('webpack:///./src/app/main.ts')).toBe('src/app/main.ts')
  })

  it('traversals, unidades Windows, esquemas y basura → ruta contenida o null', () => {
    expect(safeSourceFileName('../../etc/passwd')).toBe('etc/passwd') // aplanado, sin ..
    expect(safeSourceFileName('C:\\evil\\x.ts')).toBe('evil/x.ts')
    expect(safeSourceFileName('file:///etc/shadow')).toBe('etc/shadow')
    expect(safeSourceFileName('..')).toBeNull()
    expect(safeSourceFileName('///')).toBeNull()
    expect(safeSourceFileName('')).toBeNull()
  })
})

describe('summarizeCoverage (cobertura honesta)', () => {
  it('cuenta JS, con map, reconstruidos y huecos; out-of-scope no es ni JS ni hueco', () => {
    const entries: JsCoverageEntry[] = [
      { url: 'https://a/x.js', status: 'reconstructed', sources: 3, reconstructed: 3 },
      { url: 'https://a/y.js', status: 'no-map' },
      { url: 'https://a/z.js', status: 'map-invalid' },
      { url: 'https://a/w.js', status: 'fetch-error', error: '500' },
      { url: 'https://fuera/x.js', status: 'out-of-scope' },
    ]
    expect(summarizeCoverage(entries)).toEqual({ js: 4, withMap: 2, reconstructed: 1, gaps: 3 })
  })
})
