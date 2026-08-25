import { describe, expect, it } from 'vitest'
import { NotApprovedError, assertApproved } from './rewrite'

describe('assertApproved (guard 6.5)', () => {
  it('rechaza pending, discarded y desconocido con NotApprovedError', () => {
    for (const status of ['pending', 'discarded', undefined]) {
      expect(() => assertApproved('demo_project/reportes/x.md', status), String(status)).toThrow(
        NotApprovedError,
      )
      expect(() => assertApproved('p/x.md', 'pending')).toThrow(/Sin aprobación no se ejecuta nada/)
    }
  })

  it('deja pasar approved sin lanzar', () => {
    expect(() => assertApproved('p/x.md', 'approved')).not.toThrow()
  })
})
