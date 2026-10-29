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

export async function loadBootstrapConfig<T>(
  loader: (() => Promise<T | null>) | undefined,
  deadlineAt: number,
  signal?: AbortSignal,
  now: BootstrapClock = bootstrapNow,
): Promise<T | null> {
  if (signal?.aborted) {
    throw signal.reason ?? new Error('Bootstrap attempt was aborted')
  }
  const remainingMs = Math.max(0, deadlineAt - now())
  if (remainingMs === 0) return null

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
      return null
    }
    return now() >= deadlineAt ? null : result
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort)
  }
}

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
) {
  return {
    remotePrompt: await loadBootstrapConfig(
      loaders.remotePrompt,
      deadlineAt,
      signal,
    ),
    inputProbe: await loadBootstrapConfig(
      loaders.inputProbe,
      deadlineAt,
      signal,
    ),
    rawProbe: await loadBootstrapConfig(loaders.rawProbe, deadlineAt, signal),
    shellProbe: await loadBootstrapConfig(
      loaders.shellProbe,
      deadlineAt,
      signal,
    ),
  }
}
