import { describe, expect, it } from 'vitest'
import { groupKbEntries, UNTAGGED_KEY, type KbFacet } from './facet'
import type { KbIndexEntry } from './kb'

function entry(slug: string, over: Partial<KbIndexEntry> = {}): KbIndexEntry {
  return {
    slug,
    name: slug,
    description: '',
    category: 'tecnica',
    tags: [],
    scope: 'global',
    ...over,
  }
}

const FIXTURE: KbIndexEntry[] = [
  entry('sqli-playbook', { tags: ['xss', 'sqli'], description: 'Playbook de inyección' }),
  entry('bola-users', { tags: ['bola', 'api'], category: 'reporte' }),
  entry('sin-tags', { tags: [] }),
  entry('scope-demo', { tags: ['xss'], scope: 'project' }),
]

function group(by: KbFacet, entries: KbIndexEntry[] = FIXTURE): { key: string; slugs: string[] }[] {
  return groupKbEntries(entries, { by }).map((g) => ({ key: g.key, slugs: g.entries.map((e) => e.slug) }))
}

describe('groupKbEntries por TAG (faceto: una entrada, varios grupos)', () => {
  it('una entrada con 2 tags sale en los 2 grupos; conteos correctos', () => {
    const groups = group('tag')
    const byKey = new Map(groups.map((g) => [g.key, g.slugs]))
    // 'xss': sqli-playbook + scope-demo
    expect(byKey.get('xss')).toEqual(['sqli-playbook', 'scope-demo'])
    // 'sqli' y 'bola' y 'api': un grupo por tag
    expect(byKey.get('sqli')).toEqual(['sqli-playbook'])
    expect(byKey.get('bola')).toEqual(['bola-users'])
    expect(byKey.get('api')).toEqual(['bola-users'])
    // el total de apariciones = suma de tags de todas las entradas (3+2+0+1 = 6)
    expect(groups.reduce((n, g) => n + g.slugs.length, 0)).toBe(6)
  })

  it('entradas sin tags → grupo especial (sin etiqueta)', () => {
    const groups = group('tag', [entry('vacia')])
    expect(groups).toEqual([{ key: UNTAGGED_KEY, slugs: ['vacia'] }])
    const mixed = group('tag')
    expect(mixed.map((g) => g.key)).toContain(UNTAGGED_KEY)
    expect(new Map(mixed.map((g) => [g.key, g.slugs])).get(UNTAGGED_KEY)).toEqual(['sin-tags'])
  })

  it('TODO con tags → no existe el grupo (sin etiqueta)', () => {
    const allTagged = group('tag', [entry('a', { tags: ['x'] }), entry('b', { tags: ['y'] })])
    expect(allTagged.map((g) => g.key)).toEqual(['x', 'y'])
  })
})

describe('groupKbEntries por CATEGORÍA (partición: una entrada, un grupo)', () => {
  it('tecnica y reporte separadas, con conteos', () => {
    const groups = group('category')
    const byKey = new Map(groups.map((g) => [g.key, g.slugs]))
    expect(byKey.get('tecnica')?.length).toBe(3)
    expect(byKey.get('reporte')).toEqual(['bola-users'])
    expect(groups).toHaveLength(2)
  })

  it('solo reportes → un grupo reporte', () => {
    const groups = group('category', [entry('r1', { category: 'reporte' })])
    expect(groups).toEqual([{ key: 'reporte', slugs: ['r1'] }])
  })
})

describe('orden y casos límite', () => {
  it('orden alfabético estable de clave (locale es, numérico)', () => {
    const entries = [
      entry('a', { tags: ['zzz', 'aaa'] }),
      entry('b', { tags: ['mmm'] }),
    ]
    expect(group('tag', entries).map((g) => g.key)).toEqual(['aaa', 'mmm', 'zzz'])
    const numbered = group('tag', [entry('n', { tags: ['v2', 'v10'] })])
    expect(numbered.map((g) => g.key)).toEqual(['v2', 'v10']) // numérico: 2 < 10
  })

  it('lista vacía → []', () => {
    expect(groupKbEntries([], { by: 'tag' })).toEqual([])
    expect(groupKbEntries([], { by: 'category' })).toEqual([])
  })

  it('las entradas agrupadas son las ORIGINALES (íntegras, no copias parciales)', () => {
    const groups = groupKbEntries(FIXTURE, { by: 'category' })
    const tecnica = groups.find((g) => g.key === 'tecnica')!
    expect(tecnica.entries[0]).toEqual(FIXTURE[0])
  })
})
