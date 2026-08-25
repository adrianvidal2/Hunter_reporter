import path from 'node:path'
import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createFixture } from '../test/fixtures/fixture'
import { sha256File } from '../core/fs/hash'
import { openDb } from './db'
import { listPending, registerPending, registerPendingFile, markManuallyApproved, getPendingAction } from './pending'
import { pendingActions } from './schema'

const input = (hash: string) => ({
  path: 'demo_project/reportes/nuevo.md',
  hash,
  size: 42,
  mtimeMs: 1755000000000,
})

describe('registerPending (alta idempotente)', () => {
  it('6.2: el mismo fichero (path+hash) dos veces → UNA entrada y noop la segunda', () => {
    const fx = createFixture()
    try {
      const dbPath = path.join(fx.root, 'index.db')

      expect(registerPending(input('h1'), dbPath)).toBe('inserted')
      expect(registerPending(input('h1'), dbPath)).toBe('noop')

      const db = openDb(dbPath)
      try {
        const rows = db.select().from(pendingActions).all()
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ path: input('h1').path, hash: 'h1', status: 'pending' })
        const firstDetected = rows[0]!.detectedAt
        expect(registerPending(input('h1'), dbPath)).toBe('noop') // tercera vez igual
        expect(db.select().from(pendingActions).all()[0]!.detectedAt).toEqual(firstDetected)
      } finally {
        db.$client.close()
      }
      expect(listPending(dbPath)).toHaveLength(1)
    } finally {
      fx.cleanup()
    }
  })

  it('mismo path con hash distinto → actualiza (sigue una fila), refresca detección', () => {
    const fx = createFixture()
    try {
      const dbPath = path.join(fx.root, 'index.db')
      registerPending(input('h1'), dbPath)
      expect(registerPending({ ...input('h1'), hash: 'h2', size: 99 }, dbPath)).toBe('updated')

      const db = openDb(dbPath)
      try {
        const rows = db.select().from(pendingActions).all()
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ hash: 'h2', size: 99, status: 'pending' })
      } finally {
        db.$client.close()
      }
    } finally {
      fx.cleanup()
    }
  })

  it('pegamento watcher→BD: registerPendingFile computa hash/size/mtime del disco', () => {
    const fx = createFixture()
    try {
      const dbPath = path.join(fx.root, 'index.db')
      const nuevo = path.join(fx.draftsDir, 'detectado.md')
      writeFileSync(nuevo, '# recién llegado')

      expect(registerPendingFile(nuevo, fx.root, dbPath)).toBe('inserted')
      // el watcher re-emite el mismo fichero: nada nuevo
      expect(registerPendingFile(nuevo, fx.root, dbPath)).toBe('noop')

      const [row] = listPending(dbPath)
      expect(row.path).toBe('demo_project/reportes/detectado.md')
      expect(row.size).toBe(Buffer.byteLength('# recién llegado'))
      expect(row.hash).toHaveLength(64)
    } finally {
      fx.cleanup()
    }
  })
})

describe('markManuallyApproved (10.1: aprobación explícita desde la UI)', () => {
  const REL = 'demo_project/reportes/informe-idor.md'

  it('sin fila → crea approved con el hash ACTUAL del disco', () => {
    const fx = createFixture()
    try {
      const dbPath = path.join(fx.root, 'index.db')
      markManuallyApproved(REL, fx.root, dbPath)

      const row = getPendingAction(REL, dbPath)
      expect(row?.status).toBe('approved')
      expect(row?.hash).toBe(sha256File(fx.mdFrontMatter))
      expect(listPending(dbPath)).toHaveLength(0) // invisible en Pendientes (solo pending)
    } finally {
      fx.cleanup()
    }
  })

  it('fila pending existente → pasa a approved y refresca hash al disco actual', () => {
    const fx = createFixture()
    try {
      const dbPath = path.join(fx.root, 'index.db')
      registerPending({ path: REL, hash: 'viejo', size: 1, mtimeMs: 1 }, dbPath)
      expect(listPending(dbPath)).toHaveLength(1)

      markManuallyApproved(REL, fx.root, dbPath)

      const row = getPendingAction(REL, dbPath)
      expect(row?.status).toBe('approved')
      expect(row?.hash).toBe(sha256File(fx.mdFrontMatter))
      expect(listPending(dbPath)).toHaveLength(0) // la decisión humana la saca de Pendientes
    } finally {
      fx.cleanup()
    }
  })

  it('fichero inexistente → error de fs y BD intacta', () => {
    const fx = createFixture()
    try {
      const dbPath = path.join(fx.root, 'index.db')
      expect(() =>
        markManuallyApproved('demo_project/reportes/no-hay.md', fx.root, dbPath),
      ).toThrow()
      expect(listPending(dbPath)).toHaveLength(0)
      expect(getPendingAction('demo_project/reportes/no-hay.md', dbPath)).toBeUndefined()
    } finally {
      fx.cleanup()
    }
  })
})
