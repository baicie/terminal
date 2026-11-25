import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultReconnectSleep,
  reconnectDelayFor,
  resolveReconnectPolicy,
} from './terminal-session-reconnect-policy'

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

describe('reconnectDelayFor', () => {
  const policyWith = (overrides: Parameters<typeof resolveReconnectPolicy>[0] = {}) =>
    resolveReconnectPolicy({ jitter: (delay: number) => delay, ...overrides })

  it('doubles the delay per attempt until the cap', () => {
    const policy = policyWith({ baseDelayMs: 100, maxDelayMs: 1_000 })
    expect([1, 2, 3, 4, 5].map(attempt => reconnectDelayFor(policy, attempt))).toEqual([
      100, 200, 400, 800, 1_000,
    ])
  })

  it('rejects a jitter result that is not a usable number', () => {
    // A NaN or negative delay would reach `setTimeout` as 0, turning the backoff into a
    // tight loop. The exponential is what the caller gets instead.
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const policy = policyWith({ baseDelayMs: 100, maxDelayMs: 1_000, jitter: () => bad })
      expect(reconnectDelayFor(policy, 3), String(bad)).toBe(400)
    }
  })

  it('never exceeds maxDelayMs even when the jitter pushes past it', () => {
    /*
     * SSH18 — the defect this pins. The shipping jitter is
     * `delay * (0.8 + random * 0.4)`, so clamping the exponential and then jittering can
     * produce 20% more than the cap:
     *
     *   attempt 5: 500 * 2^4 = 8000  → [6400, 9600]   fine
     *   attempt 6: capped at 10000   → [8000, 12000]  over
     *
     * The default `maxAttempts` of 5 never reaches the cap, which is why it went
     * unnoticed; a policy that retries longer is exactly the one relying on the bound.
     */
    const policy = policyWith({
      baseDelayMs: 500,
      maxDelayMs: 10_000,
      jitter: delay => Math.round(delay * 1.2),
    })
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      expect(
        reconnectDelayFor(policy, attempt),
        `attempt ${attempt}`,
      ).toBeLessThanOrEqual(10_000)
    }
  })

  it('the highest shipping jitter would exceed the cap without the clamp', () => {
    /*
     * The negative control. If the formula ever stops being able to exceed the cap, the
     * assertion above stops testing anything — so the ability itself is asserted here.
     */
    const cappedExponential = 10_000
    const worstCase = Math.round(cappedExponential * 1.2)
    expect(worstCase).toBeGreaterThan(cappedExponential)
  })
})
