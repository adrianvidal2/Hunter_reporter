import { describe, expect, it } from 'vitest'
import { defaultProjectTab, PROJECT_TAB_ORDER } from './project-tabs'

describe('vista de proyecto — pestañas', () => {
  it('orden: Programa, Entregados, Borradores, Escaneos, Recon', () => {
    expect(PROJECT_TAB_ORDER).toEqual(['programa', 'entregados', 'borradores', 'escaneos', 'recon'])
  })

  it('Programa es la pestaña activa por defecto al cargar', () => {
    expect(defaultProjectTab()).toBe('programa')
  })
})
