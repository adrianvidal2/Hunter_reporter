import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createFixture } from '../../test/fixtures/fixture'
import { programDetailParser } from './types'
import { writeProgramArtifacts } from './artifacts'

const here = path.dirname(fileURLToPath(import.meta.url))
const raw = JSON.parse(
  readFileSync(path.resolve(here, '../../../docs/fixtures/intigriti/program-detail.json'), 'utf8'),
) as unknown
const detail = programDetailParser.parse(raw)

describe('writeProgramArtifacts Intigriti (paso 4)', () => {
  it('crea platform.json + pentest/programa.md (render propio) + programa.json crudo', () => {
    const fx = createFixture()
    try {
      const res = writeProgramArtifacts('anonymized-handle-1', detail, raw, fx.root)
      expect(res).toMatchObject({
        mdRelPath: 'anonymized-handle-1/pentest/programa.md',
        jsonRelPath: 'anonymized-handle-1/pentest/programa.json',
        platformRelPath: 'anonymized-handle-1/.config/platform.json',
        preservedExisting: false,
      })

      const platform = JSON.parse(
        readFileSync(path.join(fx.root, 'anonymized-handle-1', '.config', 'platform.json'), 'utf8'),
      )
      expect(platform).toMatchObject({ platform: 'intigriti', programId: detail.id, handle: 'anonymized-handle-1' })

      const dir = path.join(fx.root, 'anonymized-handle-1', 'pentest')
      const md = readFileSync(path.join(dir, 'programa.md'), 'utf8')
      expect(md).toContain('# Anonymized Company - Bug Bounty')
      expect(md).toContain('User-Agent requerido')
      expect(md).not.toContain('Reward grid') // render propio de Intigriti
      // json crudo: round-trip idéntico
      expect(JSON.parse(readFileSync(path.join(dir, 'programa.json'), 'utf8'))).toEqual(raw)
      expect(existsSync(path.join(fx.root, 'anonymized-handle-1', 'reportes'))).toBe(true)
      expect(readdirSync(dir).filter((f) => f.endsWith('.md'))).toHaveLength(1)
    } finally {
      fx.cleanup()
    }
  })
})
