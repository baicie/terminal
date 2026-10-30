import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultReconnectSleep } from './terminal-session-reconnect-policy'

describe('defaultReconnectSleep', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('removes its abort listener when the delay elapses', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const addListener = vi.spyOn(AbortSignal.prototype, 'addEventListener')
    const removeListener = vi.spyOn(
      AbortSignal.prototype,
      'removeEventListener',
    )
    const sleep = defaultReconnectSleep(5_000, controller.signal)

    await vi.advanceTimersByTimeAsync(5_000)

    await expect(sleep).resolves.toBeUndefined()
    expect(addListener).toHaveBeenCalledOnce()
    expect(removeListener).toHaveBeenCalledOnce()
    expect(removeListener.mock.calls[0]?.[0]).toBe('abort')
    expect(removeListener.mock.calls[0]?.[1]).toBe(
      addListener.mock.calls[0]?.[1],
    )
  })

  it('rejects with an abort error and clears the timer when cancelled', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const sleep = defaultReconnectSleep(5_000, controller.signal)
    const assertion = expect(sleep).rejects.toMatchObject({
      name: 'AbortError',
    })

    controller.abort()
    await assertion

    expect(vi.getTimerCount()).toBe(0)
  })
})
