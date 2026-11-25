export const defaultReconnectSleep = (delayMs: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
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
  const exponential = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** (attempt - 1),
  )
  const jittered = policy.jitter(exponential, attempt)
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
