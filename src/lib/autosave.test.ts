import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutosaveScheduler } from './autosave'

describe('createAutosaveScheduler (debounce 1,5 s)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('N ediciones rápidas → 1 sola escritura, tras el debounce', () => {
    const save = vi.fn()
    const scheduler = createAutosaveScheduler(save)

    for (let i = 0; i < 5; i++) {
      scheduler.schedule()
      vi.advanceTimersByTime(400) // ediciones cada 400 ms
    }
    // t=2000; el último schedule fue en t=1600 → dispararía en t=3100
    expect(save).not.toHaveBeenCalled()
    expect(scheduler.isPending()).toBe(true)

    vi.advanceTimersByTime(1100) // t=3100
    expect(save).toHaveBeenCalledTimes(1)
    expect(scheduler.isPending()).toBe(false)
  })

  it('cada edición reinicia el temporizador (nunca dispara "a medias")', () => {
    const save = vi.fn()
    const scheduler = createAutosaveScheduler(save)

    scheduler.schedule()
    vi.advanceTimersByTime(1400) // falta 100 ms
    scheduler.schedule() // reinicia
    vi.advanceTimersByTime(1400) // de nuevo falta 100 ms
    expect(save).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('cancel() aborta el guardado pendiente', () => {
    const save = vi.fn()
    const scheduler = createAutosaveScheduler(save)

    scheduler.schedule()
    scheduler.cancel()
    vi.advanceTimersByTime(5000)
    expect(save).not.toHaveBeenCalled()
    expect(scheduler.isPending()).toBe(false)
  })

  it('tras dispararse, un nuevo schedule vuelve a funcionar', () => {
    const save = vi.fn()
    const scheduler = createAutosaveScheduler(save)

    scheduler.schedule()
    vi.advanceTimersByTime(1500)
    scheduler.schedule()
    vi.advanceTimersByTime(1500)
    expect(save).toHaveBeenCalledTimes(2)
  })
})
