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

  /*
   * F04 — a signal that was already aborted never fires its event again.
   *
   * `addEventListener('abort')` on an aborted signal does nothing: the event happened in
   * the past. Without an explicit check the sleep below would wait out the full delay and
   * *resolve*, which the ladder reads as "the backoff finished" — it would then open a
   * connection the user had already cancelled.
   */
  it('rejects immediately when the signal was already aborted', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    controller.abort()

    const sleep = defaultReconnectSleep(5_000, controller.signal)

    await expect(sleep).rejects.toMatchObject({ name: 'AbortError' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not register an abort listener for an already-aborted signal', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    controller.abort()
    const addListener = vi.spyOn(AbortSignal.prototype, 'addEventListener')

    await expect(defaultReconnectSleep(5_000, controller.signal)).rejects.toThrow()

    expect(addListener).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('resolves once and ignores an abort that arrives afterwards', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const sleep = defaultReconnectSleep(1_000, controller.signal)

    await vi.advanceTimersByTimeAsync(1_000)
    await expect(sleep).resolves.toBeUndefined()

    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles once when abort and the timer race in the same tick', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    let settlements = 0
    const sleep = defaultReconnectSleep(1_000, controller.signal).then(
      () => {
        settlements += 1
      },
      () => {
        settlements += 1
      },
    )

    // Abort scheduled, then the timer's own deadline reached without letting the abort
    // task run first: both handlers are pending in the same macrotask batch.
    controller.abort()
    await vi.advanceTimersByTimeAsync(1_000)
    await sleep

    expect(settlements).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('survives repeated cancellation without leaving timers behind', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()

    for (let round = 0; round < 50; round += 1) {
      const sleep = defaultReconnectSleep(5_000, controller.signal)
      const assertion = expect(sleep).rejects.toMatchObject({ name: 'AbortError' })
      controller.abort()
      await assertion
    }

    expect(vi.getTimerCount()).toBe(0)

    // Every later call sees the already-aborted signal and must not even arm a timer.
    for (let round = 0; round < 10; round += 1) {
      await expect(
        defaultReconnectSleep(5_000, controller.signal),
      ).rejects.toMatchObject({ name: 'AbortError' })
    }
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

describe('F05 — the delay function states an input contract', () => {
  /*
   * ## Why NaN matters more than it looks
   *
   * SSH20 clamped `attempt < 1` to the first rung, which handles 0 and negatives. It did
   * not handle `NaN`: `Math.trunc(NaN)` is `NaN`, `Math.max(1, NaN)` is `NaN`, and
   * `Math.min(maxDelayMs, NaN)` is `NaN`. The function then returns `NaN` — measured, not
   * assumed. A `NaN` delay reaches `setTimeout` as 0, which is a tight retry loop against
   * a host that is already failing.
   *
   * The contract below is the one every caller can rely on: finite, non-negative,
   * integer, never above the cap. `Infinity` as a *rung* is legitimate input — it means
   * "far beyond the ladder" and must simply land on the cap.
   */
  const policyWith = (overrides: Parameters<typeof resolveReconnectPolicy>[0] = {}) =>
    resolveReconnectPolicy({ jitter: (delay: number) => delay, ...overrides })

  const assertContract = (value: number, label: string, policy: ReturnType<typeof policyWith>) => {
    expect(Number.isFinite(value), `${label} must be finite, got ${value}`).toBe(true)
    expect(value, `${label} must be a non-negative integer`).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(value), `${label} must be an integer, got ${value}`).toBe(true)
    expect(value, `${label} must not exceed maxDelayMs`).toBeLessThanOrEqual(
      policy.maxDelayMs,
    )
  }

  it('never returns NaN, whatever position it is handed', () => {
    const policy = policyWith()
    for (const attempt of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0,
      -1,
      -1e9,
      2.7,
      -2.7,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER + 1000,
      1e308,
    ]) {
      assertContract(reconnectDelayFor(policy, attempt), `attempt ${attempt}`, policy)
    }
  })

  it('treats a non-finite or fractional position as the first rung', () => {
    /*
     * A position the caller cannot mean is not a position: the shortest wait this policy
     * allows is the only defensible answer. Fractions are truncated toward zero, so 2.7
     * is rung 2 — that is the documented rounding, and the assert below states it rather
     * than leaving it to the reader.
     */
    const policy = policyWith({ baseDelayMs: 500, maxDelayMs: 10_000 })
    for (const attempt of [Number.NaN, Number.NEGATIVE_INFINITY, 0, -3, 0.5]) {
      expect(reconnectDelayFor(policy, attempt), `attempt ${attempt}`).toBe(500)
    }
    expect(reconnectDelayFor(policy, 2.7)).toBe(1_000)
    expect(reconnectDelayFor(policy, 3.9)).toBe(2_000)
  })

  it('caps an arbitrarily large finite position instead of overflowing', () => {
    /*
     * `base * 2 ** 1e308` is `Infinity`; `Math.min(cap, Infinity)` is the cap. The value
     * handed to `jitter` must therefore already be capped, or a jitter that multiplies
     * would receive `Infinity` and return `Infinity` — which the existing NaN guard would
     * catch, but for the wrong reason.
     */
    const seen: number[] = []
    const policy = policyWith({
      baseDelayMs: 500,
      maxDelayMs: 10_000,
      jitter: (delay: number) => {
        seen.push(delay)
        return delay
      },
    })
    expect(reconnectDelayFor(policy, 1e308)).toBe(10_000)
    expect(reconnectDelayFor(policy, Number.MAX_SAFE_INTEGER)).toBe(10_000)
    expect(seen.every(delay => Number.isFinite(delay) && delay <= 10_000)).toBe(true)
  })

  it('hands jitter the rung it actually used', () => {
    /*
     * The `rung` argument is what a policy uses to vary jitter per attempt. If the value
     * passed were the raw `attempt`, a jitter keyed on it could never see a normalised
     * value — and `Infinity` would arrive where an integer was promised.
     *
     * `+Infinity` maps to the first rung that already reaches the cap (500·2⁵ = 16000
     * against a 10000 cap, so rung 6), not to rung 1: "past the end of the ladder" is a
     * long wait, and handing jitter `Infinity` would break any policy that multiplies by
     * it.
     */
    const rungs: number[] = []
    const policy = policyWith({
      jitter: (delay: number, attempt: number) => {
        rungs.push(attempt)
        return delay
      },
    })
    for (const attempt of [Number.NaN, 0, 1, 2, 7, Number.POSITIVE_INFINITY]) {
      reconnectDelayFor(policy, attempt)
    }
    expect(rungs).toEqual([1, 1, 1, 2, 7, 6])
    expect(new Set(rungs).has(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('every ladder value stays inside the contract for the whole shipping policy', () => {
    const policy = resolveReconnectPolicy()
    for (let attempt = 1; attempt <= 40; attempt += 1) {
      assertContract(reconnectDelayFor(policy, attempt), `attempt ${attempt}`, policy)
    }
  })
})
