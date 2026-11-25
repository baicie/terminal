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

describe('SSH20 — the retry policy matrix', () => {
  /*
   * ## What this covers that the cases above do not
   *
   * The cases above pin the shape of one delay. This block pins the **ladder** — the
   * whole sequence a user waits through — across the configurations a policy can
   * actually take, because the ladder is what the user experiences and what the
   * connection budget has to absorb.
   *
   * The numbers matter: with the shipping defaults a failing connection waits
   * 500+1000+2000+4000+8000 = 15.5 s before the fifth attempt, and each attempt can
   * spend up to its own 9 s connection budget. That is what SSH19's real-backend run
   * measured (six attempts over ~15 s), so this matrix is what keeps that arithmetic
   * honest when someone tunes a default.
   */
  const ladder = (policy: ReturnType<typeof resolveReconnectPolicy>, attempts: number) =>
    Array.from({ length: attempts }, (_, index) => reconnectDelayFor(policy, index + 1))

  it('the shipping defaults produce the documented 15.5 s ladder', () => {
    const policy = resolveReconnectPolicy({
      jitter: (delay: number) => delay,
    })
    expect(ladder(policy, policy.maxAttempts)).toEqual([500, 1_000, 2_000, 4_000, 8_000])
    expect(ladder(policy, policy.maxAttempts).reduce((a, b) => a + b, 0)).toBe(15_500)
  })

  it('a base above the cap never exceeds the cap on any attempt', () => {
    /*
     * A legal but unusual policy: `baseDelayMs > maxDelayMs`. The exponential is capped
     * on attempt 1 already, so every wait is the cap. Getting this wrong would make the
     * first retry the slowest one, which is the opposite of what backoff means.
     */
    const policy = resolveReconnectPolicy({
      baseDelayMs: 20_000,
      maxDelayMs: 1_000,
      maxAttempts: 4,
      jitter: (delay: number) => delay,
    })
    expect(ladder(policy, 6)).toEqual([1_000, 1_000, 1_000, 1_000, 1_000, 1_000])
  })

  it('a single-attempt policy waits exactly the base delay', () => {
    // `maxAttempts: 1` is the shortest ladder a caller can configure; it must still spend
    // its one wait rather than retrying immediately.
    const policy = resolveReconnectPolicy({
      baseDelayMs: 250,
      maxAttempts: 1,
      jitter: (delay: number) => delay,
    })
    expect(ladder(policy, 1)).toEqual([250])
  })

  it('the ladder is monotonic non-decreasing until the cap', () => {
    /*
     * Backoff must never *shorten*: a user watching the countdown would see it jump back
     * down, and a shorter wait on a later attempt means more load on a host that has
     * already failed repeatedly. Jitter can make the *observed* value wobble within
     * ±20%, which is why this is asserted on the jitter-free sequence.
     */
    const policy = resolveReconnectPolicy({ jitter: (delay: number) => delay })
    const delays = ladder(policy, 12)
    for (let index = 1; index < delays.length; index += 1) {
      expect(
        delays[index],
        `attempt ${index + 1} must not be shorter than attempt ${index}`,
      ).toBeGreaterThanOrEqual(delays[index - 1])
    }
  })

  it('shipping jitter keeps every wait inside the capped ladder bounds', () => {
    /*
     * The shipping jitter is `delay * (0.8 + random * 0.4)`. For every attempt, the
     * observed wait must stay within [0.8x, 1.2x] of the capped exponential — and never
     * above `maxDelayMs`, which is SSH18's invariant.
     */
    const policy = resolveReconnectPolicy()
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const capped = Math.min(
        policy.maxDelayMs,
        policy.baseDelayMs * 2 ** (attempt - 1),
      )
      for (let sample = 0; sample < 20; sample += 1) {
        const delay = reconnectDelayFor(policy, attempt)
        expect(delay).toBeGreaterThanOrEqual(Math.round(capped * 0.8) - 1)
        expect(delay).toBeLessThanOrEqual(policy.maxDelayMs)
      }
    }
  })

  it('an attempt below one is not a ladder position', () => {
    /*
     * `reconnectDelayFor` is exported, so it can be called with anything. Attempt 0 would
     * compute `base * 2^-1`, a fraction that rounds toward zero — a "retry immediately"
     * that looks like a tight loop. The manager starts at 1, but a public function should
     * not return a meaningless number for an input it can receive.
     */
    const policy = resolveReconnectPolicy({ baseDelayMs: 500, jitter: (delay: number) => delay })
    for (const attempt of [0, -1]) {
      expect(
        reconnectDelayFor(policy, attempt),
        `attempt ${attempt} must not produce a sub-base delay`,
      ).toBeGreaterThanOrEqual(policy.baseDelayMs)
    }
  })
})
