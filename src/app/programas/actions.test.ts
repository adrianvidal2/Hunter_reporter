import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFixture } from '../../test/fixtures/fixture'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ REPORTS_ROOT: env.root }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const clientState = vi.hoisted(() => ({ impl: null as null | { getProgramWithRaw: () => Promise<unknown>; getProgram: () => Promise<unknown> } }))
vi.mock('@/core/ywh/client', () => ({
  // clase real: vi.mock exige function/class en la implementación
  YwhClient: class {
    constructor(_token: unknown) { /* noop */ }
    getProgramWithRaw() {
      if (!clientState.impl) throw new Error('YwhClient sin mock')
      return clientState.impl.getProgramWithRaw()
    }
    getProgram() {
      if (!clientState.impl) throw new Error('YwhClient sin mock')
      return clientState.impl.getProgram()
    }
  },
  YwhApiError: class extends Error {
    kind: string
    constructor(kind: string, msg: string) {
      super(msg)
      this.kind = kind
    }
  },
}))
vi.mock('@/core/ywh/token', () => ({ loadYwhToken: () => ({ jwt: 'tok', source: 'ui' }) }))

import { createProjectFromProgramAction, refreshProjectProgramAction, syncProjectProgramAction } from './actions'
import { YwhApiError, YwhClient } from '@/core/ywh/client'
import { programParser } from '@/core/ywh/types'

/** Detalle mínimo realista de un programa (como el de GET /programs/{slug}). */
const RAW = {
  title: 'Programa Test', slug: 'programa-test', type: 'bug-bounty', public: false,
  bounty: true, scopes: [{ scope: 'https://a.test', scope_type: 'web-application', asset_value: 'HIGH' }],
  rules: '# Reglas', account_access: '', qualifying_vulnerability: ['XSS'], non_qualifying_vulnerability: [],
}

function mockClientOk() {
  clientState.impl = {
    getProgramWithRaw: async () => ({
      program: programParser.parse(RAW),
      raw: RAW,
    }),
    getProgram: async () => programParser.parse(RAW),
  }
}

function mockClientSessionDead() {
  clientState.impl = {
    getProgramWithRaw: async () => {
      throw new YwhApiError('auth', 'JWT inválido o caducado (401)')
    },
    getProgram: async () => {
      throw new YwhApiError('auth', 'JWT inválido o caducado (401)')
    },
  }
}

describe('createProjectFromProgramAction (ingesta del detalle)', () => {
  beforeEach(() => {
    const fx = createFixture()
    env.root = fx.root
    return () => fx.cleanup()
  })

  it('slug válido → crea proyecto con pentest/programa.json CON detalle', async () => {
    mockClientOk()
    const res = await createProjectFromProgramAction('programa-test')
    expect(res.ok).toBe(true)
    expect(res.pendingSync).toBeUndefined()
    // programa.json canónico en pentest/ (lo que lee la pestaña Programa)
    const json = JSON.parse(readFileSync(path.join(env.root, 'programa-test', 'pentest', 'programa.json'), 'utf8'))
    expect(json.slug).toBe('programa-test')
    expect(json.scopes).toHaveLength(1)
    // estructura de proyecto también creada
    expect(existsSync(path.join(env.root, 'programa-test', 'reportes'))).toBe(true)
  })

  it('token caducado (401) → NO deja vacío en silencio: crea proyecto marcado pendiente', async () => {
    mockClientSessionDead()
    const res = await createProjectFromProgramAction('programa-test')
    expect(res.ok).toBe(true)
    expect(res.pendingSync).toBe(true)
    expect(res.syncError).toMatch(/Sesión caducada/)
    // el proyecto existe pero SIN programa.json (no un JSON vacío/roto)
    expect(existsSync(path.join(env.root, 'programa-test', 'reportes'))).toBe(true)
    expect(existsSync(path.join(env.root, 'programa-test', 'programa.json'))).toBe(false)
  })
})

describe('syncProjectProgramAction (rellena proyecto vacío existente)', () => {
  beforeEach(() => {
    const fx = createFixture()
    env.root = fx.root
    return () => fx.cleanup()
  })

  it('proyecto SIN programa.json → usa el nombre del proyecto como slug y lo rellena', async () => {
    // proyecto vacío existente (Monisnap/Globus): solo estructura
    mkdirSync(path.join(env.root, 'monisnap-bug-bounty-program-new', 'reportes'), { recursive: true })
    mockClientOk()
    const res = await syncProjectProgramAction('monisnap-bug-bounty-program-new')
    expect(res.ok).toBe(true)
    const json = JSON.parse(readFileSync(path.join(env.root, 'monisnap-bug-bounty-program-new', 'pentest', 'programa.json'), 'utf8'))
    expect(json.slug).toBe('programa-test') // venía del mock, da igual el nombre
  })

  it('token caducado en sync → pendingSync + aviso', async () => {
    mockClientSessionDead()
    const res = await syncProjectProgramAction('algun-proyecto')
    expect(res.ok).toBe(false)
    expect(res.pendingSync).toBe(true)
    expect(res.syncError).toMatch(/Sesión caducada/)
  })
})
describe('refreshProjectProgramAction (punto 2: actualizar datos del programa)', () => {
  beforeEach(() => {
    const fx = createFixture()
    env.root = fx.root
    return () => fx.cleanup()
  })

  it('reescribe pentest/programa.json+md; programa.md existente se conserva y el nuevo va fechado (9.6)', async () => {
    const dir = path.join(env.root, 'prog-existente', 'pentest')
    mkdirSync(dir, { recursive: true })
    const editado = '# MI programa.md EDITADO A MANO'
    writeFileSync(path.join(dir, 'programa.md'), editado)
    mockClientOk()

    const res = await refreshProjectProgramAction('prog-existente')
    expect(res.ok).toBe(true)
    expect(res.platform).toBe('yeswehack')
    expect(res.archivedExisting).toBe(true)
    // el editado sigue intacto; el fresco va fechado
    expect(readFileSync(path.join(dir, 'programa.md'), 'utf8')).toBe(editado)
    expect(readdirSync(dir).filter((f) => f.startsWith('programa-')).length).toBeGreaterThanOrEqual(1)
    // json actualizado con el detalle fresco
    const json = JSON.parse(readFileSync(path.join(dir, 'programa.json'), 'utf8'))
    expect(json.slug).toBe('programa-test')
  })

  it('sin programa.md previo → escribe pentest/programa.md directamente', async () => {
    mkdirSync(path.join(env.root, 'prog-nuevo', 'reportes'), { recursive: true })
    mockClientOk()
    const res = await refreshProjectProgramAction('prog-nuevo')
    expect(res.ok).toBe(true)
    expect(res.archivedExisting).toBe(false)
    expect(existsSync(path.join(env.root, 'prog-nuevo', 'pentest', 'programa.md'))).toBe(true)
  })

  it('heredado con programa.json en la raíz: la llamada lo migra a pentest/ (retrocompatible) y usa su slug', async () => {
    const dir = path.join(env.root, 'legacy-demo')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'programa.json'), JSON.stringify(RAW))
    mockClientOk()
    const res = await refreshProjectProgramAction('legacy-demo')
    expect(res.ok).toBe(true)
    // legacy de la raíz YA NO está; canónico en pentest/ y fresco
    expect(existsSync(path.join(dir, 'programa.json'))).toBe(false)
    expect(JSON.parse(readFileSync(path.join(dir, 'pentest', 'programa.json'), 'utf8')).slug).toBe('programa-test')
    expect(existsSync(path.join(dir, '.config', 'platform.json'))).toBe(true) // writeProgramArtifacts marca la plataforma
  })

  it('token caducado → pendingSync + aviso; sin escrituras nuevas', async () => {
    mockClientSessionDead()
    const res = await refreshProjectProgramAction('cualquiera')
    expect(res.ok).toBe(false)
    expect(res.pendingSync).toBe(true)
    expect(res.syncError).toMatch(/Sesión caducada/)
  })
})
