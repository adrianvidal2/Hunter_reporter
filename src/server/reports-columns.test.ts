import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clampWidth,
  DEFAULT_COLUMN_WIDTHS,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  widthFor,
} from '@/core/ywh/column-widths'
import { readColumnWidths, writeColumnWidths } from './reports-columns'

const env = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ REPORTS_ROOT: env.root }) }))

const root = mkdtempSync(join(tmpdir(), 'reports-columns-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('clampWidth y widthFor', () => {
  it('clampa respetando límites y redondea', () => {
    expect(clampWidth(10)).toBe(MIN_COLUMN_WIDTH)
    expect(clampWidth(9999)).toBe(MAX_COLUMN_WIDTH)
    expect(clampWidth(150.4)).toBe(150)
    expect(clampWidth(NaN)).toBe(MIN_COLUMN_WIDTH)
  })

  it('widthFor devuelve default si no hay state o clave', () => {
    expect(widthFor(null, 'title')).toBe(DEFAULT_COLUMN_WIDTHS.title)
    expect(widthFor({}, 'title')).toBe(DEFAULT_COLUMN_WIDTHS.title)
  })

  it('widthFor usa el valor guardado clampeado', () => {
    expect(widthFor({ title: 250 }, 'title')).toBe(250)
    expect(widthFor({ title: 5 }, 'title')).toBe(MIN_COLUMN_WIDTH)
  })
})

describe('persistencia en .config/reports-columns.json', () => {
  beforeEach(() => { env.root = root })

  it('write + read roundtrip (atómico)', () => {
    writeColumnWidths({ title: 300, date: 140 })
    const c = readColumnWidths(root)
    expect(c?.title).toBe(300)
    expect(c?.date).toBe(140)
  })

  it('clampa al guardar y al leer', () => {
    writeColumnWidths({ title: 5, reward: 10_000 })
    const c = readColumnWidths(root)
    expect(c?.title).toBe(MIN_COLUMN_WIDTH)
    expect(c?.reward).toBe(MAX_COLUMN_WIDTH)
  })

  it('solo guarda columnas conocidas', () => {
    writeColumnWidths({ title: 200, inexistente: 999 } as never)
    const raw = JSON.parse(readFileSync(join(root, '.config', 'reports-columns.json'), 'utf8'))
    expect(raw.title).toBe(200)
    expect(raw.inexistente).toBeUndefined()
  })

  it('null si no existe', () => {
    // usar un subdir limpio
    env.root = join(root, 'vacio')
    expect(readColumnWidths(env.root)).toBeNull()
  })

  it('corrupto → null', () => {
    const { mkdirSync, writeFileSync } = require('node:fs')
    mkdirSync(join(root, 'corrupto', '.config'), { recursive: true })
    writeFileSync(join(root, 'corrupto', '.config', 'reports-columns.json'), 'no-json')
    env.root = join(root, 'corrupto')
    expect(readColumnWidths(env.root)).toBeNull()
  })
})
