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
