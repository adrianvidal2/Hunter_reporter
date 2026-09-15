import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readPlatformJson, writePlatformJson } from './platform-file'

const root = mkdtempSync(path.join(tmpdir(), 'platform-json-'))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('platform.json sidecar en .config/ (paso 4 revisado)', () => {
  it('escribe en <proyecto>/.config/platform.json y lee round-trip', () => {
    writePlatformJson('proj-a', { platform: 'yeswehack', slug: 'prog-1' }, root)
    const raw = JSON.parse(readFileSync(path.join(root, 'proj-a', '.config', 'platform.json'), 'utf8'))
    expect(raw.platform).toBe('yeswehack')
    expect(raw.slug).toBe('prog-1')
    expect(typeof raw.updatedAt).toBe('string')
    // NADA en la raíz del proyecto
    expect(existsSync(path.join(root, 'proj-a', 'platform.json'))).toBe(false)

    const read = readPlatformJson('proj-a', root)
    expect(read?.platform).toBe('yeswehack')
    expect(read?.slug).toBe('prog-1')
  })

  it('actualización preservando idempotencia (mismo path)', () => {
    writePlatformJson('proj-b', { platform: 'intigriti', programId: 'uuid-1', handle: 'h' }, root)
    writePlatformJson('proj-b', { platform: 'intigriti', programId: 'uuid-1', handle: 'h' }, root)
    expect(readPlatformJson('proj-b', root)?.handle).toBe('h')
  })

  it('LECTURA RETROCOMPATIBLE: legacy en la raíz → se lee, se migra a .config/ y se borra el de la raíz', () => {
    mkdirSync(path.join(root, 'proj-legacy'), { recursive: true })
    writeFileSync(
      path.join(root, 'proj-legacy', 'platform.json'),
      JSON.stringify({ platform: 'yeswehack', slug: 'legacy-1', updatedAt: '2026-09-01T00:00:00.000Z' }, null, 2) + '\n',
    )

    const read = readPlatformJson('proj-legacy', root)
    expect(read?.platform).toBe('yeswehack')
    expect(read?.slug).toBe('legacy-1')

    // migrado a .config/ y el de la raíz YA NO ESTÁ
    expect(existsSync(path.join(root, 'proj-legacy', '.config', 'platform.json'))).toBe(true)
    expect(existsSync(path.join(root, 'proj-legacy', 'platform.json'))).toBe(false)
    // segunda lectura: estable (ya desde .config/)
    expect(readPlatformJson('proj-legacy', root)?.slug).toBe('legacy-1')
  })

  it('plataforma desconocida rechazada al escribir; fichero corrupto/ausente → null', () => {
    expect(() => writePlatformJson('proj-c', { platform: 'hackertarget' as never }, root)).toThrow(/desconocida/)
    expect(readPlatformJson('proj-c', root)).toBeNull()
  })
})
