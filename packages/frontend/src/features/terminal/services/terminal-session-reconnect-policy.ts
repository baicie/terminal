export const defaultReconnectSleep = (delayMs: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    /*
     * F04 — an already-aborted signal never fires its event again.
     *
     * `addEventListener('abort')` on a signal that aborted in the past does nothing, so
     * without this check the sleep waits out the whole delay and *resolves*. Any caller
     * that trusts the resolve as "the backoff elapsed" then acts on a cancellation it was
     * supposed to honour. Rejecting here also means no timer is ever armed.
     *
     * Production reachability, measured rather than assumed: the reconnect ladder checks
     * `signal.aborted` again after the sleep *and* `isActive()` after that, so today a
     * cancelled ladder does return without connecting — but only after sitting out the
     * full delay holding its timer. This module is exported and the ladder is not its
     * only possible caller, so the contract belongs here rather than in each consumer.
     */
    if (signal?.aborted) {
      reject(new DOMException('Reconnect cancelled', 'AbortError'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Reconnect cancelled', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', onAbort, { once: true })
  })

export const defaultReconnectJitter = (delayMs: number) =>
  Math.round(delayMs * (0.8 + Math.random() * 0.4))

export function positiveReconnectInteger(
  value: number | undefined,
  fallback: number,
): number {
  return Number.isSafeInteger(value) && value !== undefined && value > 0
    ? value
    : fallback
}

export interface ReconnectPolicyOptions {
  baseDelayMs?: number
  maxDelayMs?: number
  maxAttempts?: number
  recoveryDelayMs?: number
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>
  jitter?: (delayMs: number, attempt: number) => number
  now?: () => number
}

/**
 * Normalises the reconnect timings once so the session manager only consumes
 * the resolved policy instead of repeating every default at the call site.
 */
export function resolveReconnectPolicy(options: ReconnectPolicyOptions = {}) {
  return {
    baseDelayMs: positiveReconnectInteger(options.baseDelayMs, 500),
    maxDelayMs: positiveReconnectInteger(options.maxDelayMs, 10_000),
    maxAttempts: positiveReconnectInteger(options.maxAttempts, 5),
    recoveryDelayMs: positiveReconnectInteger(options.recoveryDelayMs, 30_000),
    sleep: options.sleep ?? defaultReconnectSleep,
    jitter: options.jitter ?? defaultReconnectJitter,
    now: options.now ?? Date.now,
  }
}

/**
 * The first rung whose exponential has already reached the cap.
 *
 * `+Infinity` as a ladder position means "past the end", and the honest answer is the
 * capped wait — but `jitter` is also given the rung, and handing it `Infinity` would
 * break a policy that multiplies or indexes by it. This computes the finite rung that
 * produces the same capped value, so jitter receives a real position.
 *
 * Bounded at 64 iterations: `2 ** 63 · base` overflows `Number` for any sane base, so the
 * cap is always reached long before. The loop is defensive, not arithmetic.
 */
function saturationRung(policy: {
  baseDelayMs: number
  maxDelayMs: number
}): number {
  let rung = 1
  while (rung < 64 && policy.baseDelayMs * 2 ** (rung - 1) < policy.maxDelayMs) {
    rung += 1
  }
  return rung
}

/**
 * The wait before attempt `attempt` (1-based), in milliseconds.
 *
 * Extracted from `TerminalSessionManager` so the rule can be stated and tested on its
 * own — the manager's file is at its size limit, and a delay is a pure function of the
 * policy and the attempt.
 */
export function reconnectDelayFor(
  policy: ReturnType<typeof resolveReconnectPolicy>,
  attempt: number,
): number {
  /*
   * SSH20 — the ladder has no position below one.
   *
   * `attempt` is 1-based, and the manager always starts there. This is exported, though,
   * so it can be handed 0 or a negative: `base * 2^-1` is a *fraction* of the base delay,
   * which rounds toward zero and turns "back off" into "retry immediately". Clamping the
   * index keeps the first rung the shortest wait this policy allows.
   *
   * F05 — a position that is not a usable number is not a position either.
   * `Math.trunc(NaN)` is `NaN`, and `Math.max(1, NaN)` stays `NaN`, so the SSH20 clamp
   * alone let `NaN` travel all the way to the return value. Measured before the fix:
   * `reconnectDelayFor(policy, NaN) === NaN`. A `NaN` delay reaches `setTimeout` as 0,
   * turning the backoff into a tight loop against a host that is already failing.
   *
   * `+Infinity` *is* meaningful — "far beyond this ladder" — and must land on the cap
   * rather than be treated as garbage. So: non-finite (other than +Infinity) and
   * below-one positions become rung 1; fractions truncate toward zero; anything else is
   * used as given, and the exponential saturates at `maxDelayMs` before it can overflow.
   */
  const rung =
    attempt === Number.POSITIVE_INFINITY
      ? saturationRung(policy)
      : Number.isFinite(attempt)
        ? Math.max(1, Math.trunc(attempt))
        : 1
  const exponential = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** (rung - 1),
  )
  const jittered = policy.jitter(exponential, rung)
  const settled =
    Number.isFinite(jittered) && jittered >= 0 ? Math.round(jittered) : exponential
  /*
   * SSH18 — the cap applies AFTER jitter.
   *
   * Clamping the exponential and then jittering lets the shipping
   * `delay * (0.8 + random * 0.4)` produce 20% more than `maxDelayMs`. Measured: with
   * `maxDelayMs: 1000` and `jitter: d => round(d * 1.2)`, attempt 5 slept 1200 ms.
   *
   * `maxDelayMs` is the longest wait a user is promised between attempts, so the bound
   * has to hold for the number that is actually slept. The default `maxAttempts` of 5
   * reaches the cap only on attempt 5 (500·2⁴ = 8000 against a 10 s cap), which is why
   * this stayed invisible — a policy that retries longer is the one relying on it.
   */
  return Math.min(policy.maxDelayMs, settled)
}
