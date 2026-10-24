import { afterEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn(() => Promise.resolve())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
const { holdTypes, TYPES_IDLE_MS } = await import('./typesInUse')

describe('holdTypes', () => {
  afterEach(() => {
    invoke.mockClear()
    vi.useRealTimers()
  })

  it('stops TypeScript a while after the last editor closes, unless another opens meanwhile', () => {
    vi.useFakeTimers()
    const first = holdTypes('/r')
    const second = holdTypes('/r')
    first()
    vi.advanceTimersByTime(TYPES_IDLE_MS * 2)
    // One still open.
    expect(invoke).not.toHaveBeenCalled()
    second()
    vi.advanceTimersByTime(TYPES_IDLE_MS / 2)
    const again = holdTypes('/r')
    vi.advanceTimersByTime(TYPES_IDLE_MS)
    // Opened again in time: kept.
    expect(invoke).not.toHaveBeenCalled()
    again()
    again()
    vi.advanceTimersByTime(TYPES_IDLE_MS)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('ts_stop', { repo: '/r' })
  })
})
