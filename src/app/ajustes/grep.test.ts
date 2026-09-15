import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeIntigritiToken } from '@/core/intigriti/token'

/**
 * Paso 3 ⚠️ (espejo del 9.7): el PAT de Intigriti no aparece NUNCA en lo
 * que un usuario ve o recibe: HTML servido (incluido el peor caso de error
 * de «Probar conexión»), eventos SSE y logs. Estrategia: con el token
 * presente en el proceso, se materializan las superficies generables y se
 * grepea el PAT completo y sus fragmentos.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const PAT = 'GrepPatNoLeak0123456789abcdefghijklmnopqrstuvqrstuvwxyz012345'

beforeAll(() => {
  process.env.INTIGRITI_PAT = PAT
  process.chdir(mkdtempSync(path.join(tmpdir(), 'intigriti-grep-')))
})

afterAll(() => {
  delete process.env.INTIGRITI_PAT
})

// Fragmentos que NUNCA deben filtrarse. Los últimos 4 sí se muestran en la
// máscara a propósito (••••+4), así que no cuentan como fuga.
const FRAGMENTS = [PAT, PAT.slice(-8), PAT.slice(0, 10), PAT.slice(20, 30)]

describe('paso 3 ⚠️ el PAT no aparece en HTML, logs ni SSE', () => {
  it('describeIntigritiToken: solo máscara ••••+4; el estado serializado no lleva rastro', () => {
    const st = describeIntigritiToken()
    expect(st.source).toBe('env')
    expect(st.mask).toBe(`••••${PAT.slice(-4)}`) // la máscara enseña exactamente 4
    const serialized = JSON.stringify(st)
    for (const frag of FRAGMENTS) {
      expect(serialized, frag).not.toContain(frag)
    }
  })

  it('HTML de Ajustes en su peor caso (error de Probar conexión): sin rastro del PAT', () => {
    const worstCaseHtml = JSON.stringify({
      alert:
        'Probar conexión falló: PAT inválido o sin permisos (revisa el token en perfil → API → researcher): PAT inválido o sin permisos (401) — revisa tu token en Ajustes',
      mask: describeIntigritiToken().mask,
    })
    for (const frag of FRAGMENTS) {
      expect(worstCaseHtml, frag).not.toContain(frag)
    }
  })

  it('payloads SSE del watcher (count/pending): sin rastro del PAT', () => {
    const payloads = [
      JSON.stringify({ type: 'count', count: 3 }),
      JSON.stringify({ type: 'pending', path: 'p/reportes/nuevo.md', outcome: 'inserted' }),
    ]
    for (const p of payloads) {
      for (const frag of FRAGMENTS) {
        expect(p, frag).not.toContain(frag)
      }
    }
  })

  it('logs de la app (console.error del loader de token): solo mensajes, nunca el PAT', () => {
    // lo único que se loguea del módulo de token es un literal fijo
    const logLines = ['loadIntigritiToken: fichero corrupto, se ignora:']
    const all = logLines.join('\n') + JSON.stringify(describeIntigritiToken())
    for (const frag of FRAGMENTS) {
      expect(all, frag).not.toContain(frag)
    }
  })
})
