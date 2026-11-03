// Probe configuration only selects explicitly enabled test entry points. It
// must not hold the normal application hostage while backend IPC is starting.
export const BOOTSTRAP_CONFIG_DEADLINE_MS = 1_000
// The normal application chunk is bundled locally, but a bounded deadline is
// still required so a stalled WebView import cannot leave a blank window.
export const BOOTSTRAP_APP_DEADLINE_MS = 8_000
// Default delay for direct App mounts that do not receive the bootstrap
// attempt's absolute fallback timestamp.
export const BOOTSTRAP_TERMINAL_FALLBACK_MS = 2_000

export type BootstrapClock = () => number

export const bootstrapNow: BootstrapClock = () => performance.now()

async function waitUntilBootstrapDeadline(
  deadlineAt: number,
  signal: AbortSignal | undefined,
  now: BootstrapClock,
): Promise<void> {
  while (true) {
    const remainingMs = deadlineAt - now()
    if (remainingMs <= 0) return
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let onAbort: (() => void) | undefined
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer)
        if (onAbort !== undefined) {
          signal?.removeEventListener('abort', onAbort)
        }
      }
      const finish = () => {
        cleanup()
        resolve()
      }
      onAbort = () => {
        cleanup()
        reject(signal?.reason ?? new Error('Bootstrap attempt was aborted'))
      }
      timer = setTimeout(finish, remainingMs)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
    })
  }
}

/**
 * How one gate's configuration read ended.
 *
 * Three outcomes look identical from the value alone (`null`), and they need
 * opposite answers: a gate that is not enabled is normal, a gate whose IPC was
 * slower than the budget is a probe that will never report, and a gate that was
 * never invoked at all is a scheduler bug. Without this record a silent
 * fallback to the normal application is indistinguishable from an ordinary
 * launch (P9.3.1 P1-2).
 */
export type BootstrapConfigOutcome
  = | 'not-configured'
    | 'loaded'
    | 'timed-out'
    | 'deadline-passed'
    | 'errored'

export interface BootstrapConfigReport {
  gate: string
  outcome: BootstrapConfigOutcome
  /** Milliseconds this gate spent, from its own start to its verdict. */
  elapsedMs: number
  /** Present only for `errored`, and only with the message, never the payload. */
  error?: string
}

export async function loadBootstrapConfig<T>(
  loader: (() => Promise<T | null>) | undefined,
  deadlineAt: number,
  signal?: AbortSignal,
  now: BootstrapClock = bootstrapNow,
  report?: (report: BootstrapConfigReport) => void,
  gate = 'config',
): Promise<T | null> {
  const startedAt = now()
  const finish = (outcome: BootstrapConfigOutcome, error?: unknown): void => {
    report?.({
      gate,
      outcome,
      elapsedMs: Math.max(0, Math.round(now() - startedAt)),
      // The message only: a gate config carries endpoints and tokens, and a
      // diagnostic that leaks one is worse than the silence it replaces.
      ...(error === undefined
        ? {}
        : { error: error instanceof Error ? error.message : String(error) }),
    })
  }
  if (loader === undefined) {
    finish('not-configured')
    return null
  }
  if (signal?.aborted) {
    finish('errored', signal.reason ?? new Error('Bootstrap attempt was aborted'))
    throw signal.reason ?? new Error('Bootstrap attempt was aborted')
  }
  const remainingMs = Math.max(0, deadlineAt - now())
  if (remainingMs === 0) {
    // The budget was gone before this gate was asked: it never ran at all, and
    // saying "not enabled" here is what hid the starvation for weeks.
    finish('deadline-passed')
    return null
  }

  const pending = Promise.resolve().then(() => loader?.() ?? null)
  // Keep observing rejection even if the timeout wins the race.
  void pending.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutMarker = Symbol('bootstrap-timeout')
  const timeout = new Promise<typeof timeoutMarker>(resolve => {
    timer = setTimeout(() => resolve(timeoutMarker), remainingMs)
  })
  let onAbort: (() => void) | undefined
  const aborted = signal
    ? new Promise<T | null>((_resolve, reject) => {
        onAbort = () =>
          reject(signal.reason ?? new Error('Bootstrap attempt was aborted'))
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      })
    : null
  try {
    const result = await Promise.race(
      aborted === null ? [pending, timeout] : [pending, timeout, aborted],
    )
    if (result === timeoutMarker) {
      // Timers can fire a fraction early relative to performance.now(). Keep
      // the absolute deadline strict before allowing the next probe to start.
      await waitUntilBootstrapDeadline(deadlineAt, signal, now)
      finish('timed-out')
      return null
    }
    if (now() >= deadlineAt) {
      finish('timed-out')
      return null
    }
    finish(result === null ? 'not-configured' : 'loaded')
    return result
  } catch (error) {
    finish('errored', error)
    throw error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Loads every optional probe configuration within the same absolute budget.
 *
 * The loaders are five independent IPC round-trips, and they used to run one
 * after another against a single absolute deadline. That made the budget a
 * queue: when the first round-trip took most of the second (a cold WebView's
 * first calls are the slowest ones), the loaders behind it were never invoked
 * at all -- `loadBootstrapConfig` returns null without calling the loader once
 * the deadline has passed. Nothing was logged, the normal application mounted,
 * and the acceptance runner could only report that result.json never appeared
 * 60 seconds later (run 41437956656, macOS `nano-edit`).
 *
 * Starting them together keeps a slow loader from starving the rest while each
 * one still gives up at the same absolute deadline.
 */
export async function loadOptionalBootstrapConfigs<
  TRemote,
  TProbe,
  TRaw,
  TShell,
>(
  loaders: {
    remotePrompt?: () => Promise<TRemote | null>
    inputProbe: () => Promise<TProbe | null>
    rawProbe?: () => Promise<TRaw | null>
    shellProbe?: () => Promise<TShell | null>
  },
  deadlineAt: number,
  signal?: AbortSignal,
  report?: (report: BootstrapConfigReport) => void,
) {
  const [remotePrompt, inputProbe, rawProbe, shellProbe] = await Promise.all([
    loadBootstrapConfig(loaders.remotePrompt, deadlineAt, signal, bootstrapNow, report, 'remotePrompt'),
    loadBootstrapConfig(loaders.inputProbe, deadlineAt, signal, bootstrapNow, report, 'inputProbe'),
    loadBootstrapConfig(loaders.rawProbe, deadlineAt, signal, bootstrapNow, report, 'rawProbe'),
    loadBootstrapConfig(loaders.shellProbe, deadlineAt, signal, bootstrapNow, report, 'shellProbe'),
  ])
  return { remotePrompt, inputProbe, rawProbe, shellProbe }
}

