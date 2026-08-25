import { describe, expect, it } from 'vitest'
import { defaultSortReports, filterReportsByState, formatReward, reportStateLabel, reportStateOptions, sortReports, statePriority } from './reports'
import type { UserReport } from './reports'

function makeReport(partial: Partial<UserReport>): UserReport {
  return {
    id: 1, local_id: 'YWH-1', title: 'T', scope: '', program: { title: 'P', slug: 'p', public: false, bounty: true },
    status: { workflow_state: 'under_review' }, cvss: null, hunter: null, reward: null, cost_credits: null,
    currency: 'EUR', marked_as: '', collaborative: false, created_at: null, changed_at: null,
    ask_for_fix_verification_status: '', ...partial,
  }
}

describe('formatReward (reward en céntimos → importe formateado)', () => {
  it('divide por 100 y formatea en EUR', () => {
    expect(formatReward(75_000, 'EUR')).toBe('750 €')
    expect(formatReward(300_000, 'EUR')).toBe('3.000 €')
    expect(formatReward(50_000, 'EUR')).toBe('500 €')
    expect(formatReward(30_000, 'EUR')).toBe('300 €')
    expect(formatReward(0, 'EUR')).toBe('0 €')
  })

  it('null → "—"', () => {
    expect(formatReward(null, 'EUR')).toBe('—')
    expect(formatReward(undefined, 'EUR')).toBe('—')
  })

  it('currency ausente → EUR por defecto', () => {
    expect(formatReward(75_000, null)).toBe('750 €')
    expect(formatReward(75_000, undefined)).toBe('750 €')
  })

  it('otras monedas usan su símbolo', () => {
    expect(formatReward(75_000, 'USD')).toBe('750 US$')
  })
})

describe('filtro por estado (derivado de la cache)', () => {
  const items = [
    makeReport({ id: 1, status: { workflow_state: 'under_review' } }),
    makeReport({ id: 2, status: { workflow_state: 'accepted' } }),
    makeReport({ id: 3, status: { workflow_state: 'under_review' } }),
    makeReport({ id: 4, status: { workflow_state: 'informative' } }),
  ]

  it('opciones derivadas de los estados presentes (no hardcodeada)', () => {
    const opts = reportStateOptions(items)
    expect(opts.map((o) => o.value)).toEqual(['under_review', 'accepted', 'informative'])
  })

  it('opciones del filtro ORDENADAS por prioridad de estado (no por aparición)', () => {
    // Mezclados a propósito, con un estado no listado de por medio.
    const shuffled = [
      makeReport({ id: 1, status: { workflow_state: 'resolved' } }),
      makeReport({ id: 2, status: { workflow_state: 'informative' } }),
      makeReport({ id: 3, status: { workflow_state: 'under_review' } }),
      makeReport({ id: 4, status: { workflow_state: 'accepted' } }),
      makeReport({ id: 5, status: { workflow_state: 'zzz' } }),
      makeReport({ id: 6, status: { workflow_state: 'rtfs' } }),
      makeReport({ id: 7, status: { workflow_state: 'out_of_scope' } }),
      makeReport({ id: 8, status: { workflow_state: 'duplicate' } }),
      makeReport({ id: 9, status: { workflow_state: 'aaa' } }),
    ]
    const opts = reportStateOptions(shuffled)
    expect(opts.map((o) => o.value)).toEqual([
      'under_review', // 0
      'accepted', // 1
      'resolved', // 2
      'informative', // 3
      'rtfs', // 4
      'out_of_scope', // 5
      'duplicate', // 6
      // no listados al final, en orden de aparición
      'zzz',
      'aaa',
    ])
  })

  it('filtro deja SOLO los del estado elegido', () => {
    const filtered = filterReportsByState(items, 'under_review')
    expect(filtered.map((r) => r.id)).toEqual([1, 3])
  })

  it('"Todos" (estado vacío) muestra todo', () => {
    expect(filterReportsByState(items, '')).toHaveLength(4)
  })

  it('reportStateLabel traduce estados conocidos y cae al crudo si no', () => {
    expect(reportStateLabel('under_review')).toBe('En revisión')
    expect(reportStateLabel('rtfs')).toBe('RTFS')
    expect(reportStateLabel('estado_extraño')).toBe('estado_extraño')
  })

  it('ignora reportes sin estado al derivar opciones', () => {
    const withNull = [...items, makeReport({ id: 5, status: null })]
    expect(reportStateOptions(withNull).map((o) => o.value)).toEqual(['under_review', 'accepted', 'informative'])
  })
})

describe('sortReports (clic en cabecera asc/desc)', () => {
  const items = [
    makeReport({ id: 3, title: 'Charlie', status: { workflow_state: 'accepted' }, reward: 30000, cvss: { criticity: 'L', score: 4, vector: '', version: '' }, created_at: '2026-01-03T00:00:00Z' }),
    makeReport({ id: 1, title: 'Alpha', status: { workflow_state: 'under_review' }, reward: 15000, cvss: { criticity: 'H', score: 7, vector: '', version: '' }, created_at: '2026-01-01T00:00:00Z' }),
    makeReport({ id: 2, title: 'Bravo', status: { workflow_state: 'resolved' }, reward: 50000, cvss: { criticity: 'C', score: 9, vector: '', version: '' }, created_at: '2026-01-02T00:00:00Z' }),
  ]

  it('title asc/desc (alfabético, segundo clic invierte)', () => {
    expect(sortReports(items, 'title', 'asc').map((r) => r.id)).toEqual([1, 2, 3])
    expect(sortReports(items, 'title', 'desc').map((r) => r.id)).toEqual([3, 2, 1])
  })

  it('severity: cvss.score numérico asc/desc', () => {
    expect(sortReports(items, 'severity', 'asc').map((r) => r.id)).toEqual([3, 1, 2])
    expect(sortReports(items, 'severity', 'desc').map((r) => r.id)).toEqual([2, 1, 3])
  })

  it('reward asc/desc (importe, no formato)', () => {
    expect(sortReports(items, 'reward', 'asc').map((r) => r.id)).toEqual([1, 3, 2])
    expect(sortReports(items, 'reward', 'desc').map((r) => r.id)).toEqual([2, 3, 1])
  })

  it('fecha asc/desc', () => {
    expect(sortReports(items, 'date', 'asc').map((r) => r.id)).toEqual([1, 2, 3])
    expect(sortReports(items, 'date', 'desc').map((r) => r.id)).toEqual([3, 2, 1])
  })

  it('estado asc', () => {
    expect(sortReports(items, 'state', 'asc').map((r) => r.id)).toEqual([3, 2, 1]) // accepted < resolved < under_review
  })

  it('NO muta el array original', () => {
    const copy = [...items]
    sortReports(items, 'title', 'desc')
    expect(items.map((r) => r.id)).toEqual([3, 1, 2]) // intacto
    expect(copy).not.toEqual(sortReports(items, 'title', 'desc'))
  })
})

describe('defaultSortReports (orden inicial por estado, no alfabético)', () => {
  const items = [
    // accepted, fechas: nuevo 02, viejo 01
    makeReport({ id: 1, title: 'Acc viejo', status: { workflow_state: 'accepted' }, created_at: '2026-01-01T00:00:00Z' }),
    makeReport({ id: 2, title: 'Acc nuevo', status: { workflow_state: 'accepted' }, created_at: '2026-01-02T00:00:00Z' }),
    // under_review, fechas: nuevo 05, viejo 04
    makeReport({ id: 3, title: 'Rev viejo', status: { workflow_state: 'under_review' }, created_at: '2026-01-04T00:00:00Z' }),
    makeReport({ id: 4, title: 'Rev nuevo', status: { workflow_state: 'under_review' }, created_at: '2026-01-05T00:00:00Z' }),
    // resolved (debe ir DESPUÉS de accepted)
    makeReport({ id: 5, title: 'Res', status: { workflow_state: 'resolved' }, created_at: '2026-01-03T00:00:00Z' }),
    // estado no listado → al final
    makeReport({ id: 6, title: 'Otro', status: { workflow_state: 'weird_state' }, created_at: '2026-01-06T00:00:00Z' }),
  ]

  it('under_review antes que accepted, y accepted antes que resolved', () => {
    const sorted = defaultSortReports(items)
    const byId = sorted.map((r) => r.id)
    // grupo under_review (3,4) → grupo accepted (1,2) → resolved (5) → resto (6)
    expect(byId.indexOf(3)).toBeLessThan(byId.indexOf(1))
    expect(byId.indexOf(1)).toBeLessThan(byId.indexOf(5))
  })

  it('dentro de un grupo, el más reciente primero (fecha desc)', () => {
    const sorted = defaultSortReports(items).filter((r) => r.status?.workflow_state === 'under_review')
    expect(sorted.map((r) => r.id)).toEqual([4, 3]) // nuevo antes que viejo
    const acc = defaultSortReports(items).filter((r) => r.status?.workflow_state === 'accepted')
    expect(acc.map((r) => r.id)).toEqual([2, 1])
  })

  it('estado no listado va al final', () => {
    const sorted = defaultSortReports(items)
    expect(sorted[sorted.length - 1]!.id).toBe(6)
  })

  it('statePriority: no alfabético y explícito', () => {
    expect(statePriority('under_review')).toBeLessThan(statePriority('accepted'))
    expect(statePriority('accepted')).toBeLessThan(statePriority('resolved'))
    expect(statePriority('resolved')).toBeLessThan(statePriority('informative'))
    expect(statePriority('informative')).toBeLessThan(statePriority('rtfs'))
    expect(statePriority('rtfs')).toBeLessThan(statePriority('out_of_scope'))
    expect(statePriority('whatever')).toBeGreaterThan(statePriority('duplicate'))
  })
})
