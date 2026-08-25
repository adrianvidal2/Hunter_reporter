import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFixture, type Fixture } from '../../test/fixtures/fixture'
import { sha256File } from '@/core/fs/hash'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ REPORTS_ROOT: env.root }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { acceptRewriteAction } from './actions'
import { discardPendingAction } from '../actions'
import { getPendingAction, registerPending } from '@/db/pending'

const REL = 'demo_project/reportes/informe-idor.md'
const PROPOSAL = '# IDOR in /api/v1/users\n\n## Executive Summary\n\nTransalted proposal.\n'

describe('acceptRewriteAction (8.5 ⚠️)', () => {
  let fx: Fixture
  let dbPath: string

  beforeEach(() => {
    fx = createFixture()
    env.root = fx.root
    dbPath = path.join(fx.root, 'index.db')
    process.env.DB_PATH = dbPath
    // pendiente registrado con el hash REAL del disco (como haría el watcher)
    const st = statSync(fx.mdFrontMatter)
    registerPending(
      { path: REL, hash: sha256File(fx.mdFrontMatter), size: st.size, mtimeMs: Math.round(st.mtimeMs) },
      dbPath,
    )
    return () => {
      delete process.env.DB_PATH
      fx.cleanup()
    }
  })

  it('guarda la propuesta y el ORIGINAL queda archivado y RECUPERABLE en .history/', async () => {
    const original = readFileSync(fx.mdFrontMatter, 'utf8') // contiene 'severity: critical'

    const res = await acceptRewriteAction(REL, PROPOSAL)
    expect(res.ok).toBe(true)
    expect(res.archivedTo).toBeTruthy()

    // el fichero ahora contiene la propuesta
    expect(readFileSync(fx.mdFrontMatter, 'utf8')).toBe(PROPOSAL)

    // y el original se puede recuperar byte a byte desde .history/
    const dir = path.join(fx.root, '.history/demo_project/reportes/informe-idor.md')
    const entries = readdirSync(dir)
    expect(entries).toHaveLength(1)
    const recovered = readFileSync(path.join(dir, entries[0]!), 'utf8')
    expect(recovered).toBe(original)
    expect(recovered).toContain('severity: critical')

    // la decisión humana queda registrada
    expect(getPendingAction(REL, dbPath)!.status).toBe('approved')
  })

  it('guard de hash: fichero cambiado desde la detección → rechazo y CERO escrituras', async () => {
    writeFileSync(fx.mdFrontMatter, 'editado a mano tras la detección')

    const res = await acceptRewriteAction(REL, PROPOSAL)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/cambió desde la detección/)

    expect(readFileSync(fx.mdFrontMatter, 'utf8')).toBe('editado a mano tras la detección')
    expect(existsSync(path.join(fx.root, '.history'))).toBe(false) // ni archivó
    expect(getPendingAction(REL, dbPath)!.status).toBe('pending') // sigue pendiente
  })

  it('path no pendiente o propuesta vacía → error sin tocar nada', async () => {
    const vacia = await acceptRewriteAction(REL, '   ')
    expect(vacia.ok).toBe(false)
    expect(vacia.error).toMatch(/vacía/i)

    const desconocido = await acceptRewriteAction('demo_project/reportes/nunca.md', PROPOSAL)
    expect(desconocido.ok).toBe(false)
    expect(desconocido.error).toMatch(/ya no está pendiente/)

    expect(readFileSync(fx.mdFrontMatter, 'utf8')).toContain('IDOR en /api/v1/users')
  })
})

describe('discardPendingAction (8.6 ⚠️: el original queda idéntico byte a byte)', () => {
  let fx: Fixture
  let dbPath: string

  beforeEach(() => {
    fx = createFixture()
    env.root = fx.root
    dbPath = path.join(fx.root, 'index.db')
    process.env.DB_PATH = dbPath
    const st = statSync(fx.mdFrontMatter)
    registerPending(
      { path: REL, hash: sha256File(fx.mdFrontMatter), size: st.size, mtimeMs: Math.round(st.mtimeMs) },
      dbPath,
    )
    return () => {
      delete process.env.DB_PATH
      fx.cleanup()
    }
  })

  it('tras descartar, hash antes == después y ninguna carpeta nueva aparece', async () => {
    const hashAntes = sha256File(fx.mdFrontMatter)
    const statAntes = statSync(fx.mdFrontMatter)

    const res = await discardPendingAction(REL)
    expect(res).toEqual({ ok: true })

    // byte a byte idéntico (hash) y mismo mtime: ni se reescribió
    expect(sha256File(fx.mdFrontMatter)).toBe(hashAntes)
    expect(Math.round(statSync(fx.mdFrontMatter).mtimeMs)).toBe(Math.round(statAntes.mtimeMs))

    // cero huellas: ni .history ni .trash
    expect(existsSync(path.join(fx.root, '.history'))).toBe(false)
    expect(existsSync(path.join(fx.root, '.trash'))).toBe(false)

    expect(getPendingAction(REL, dbPath)!.status).toBe('discarded')
  })
})
