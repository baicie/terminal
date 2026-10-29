import { terminalSessionManager } from '@/features/terminal/services/terminal-session-manager'
import type {
  TerminalSmokeHostWakeEvent,
  TerminalSmokeHostWakeReporter,
  TerminalSmokeHostWakeSource,
} from './terminal-smoke-contract'

export const TERMINAL_SMOKE_HOST_WAKE_TRIGGER_MS = 15_000
export const TERMINAL_SMOKE_HOST_WAKE_REPORT_TIMEOUT_MS = 5_000

// A timed-out caller must not release a reporter operation that is still
// executing. Tauri invoke has no cancellation option, so serialize calls per
// reporter until the underlying promise settles.
const reporterInFlight = new WeakMap<
  TerminalSmokeHostWakeReporter,
  Promise<void>
>()

export type { TerminalSmokeHostWakeSource } from './terminal-smoke-contract'

export function logTerminalSmokeHostWakeDiagnostic(
  event: string,
  source: TerminalSmokeHostWakeSource,
  detail?: string,
): void {
  console.info(
    `[terminal-smoke-host-wake] ${event} source=${source}${detail ? ` ${detail}` : ''}`,
  )
}

export function logTerminalSmokeHostWakeReportFailure(
  event: TerminalSmokeHostWakeEvent,
  source: TerminalSmokeHostWakeSource,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error)
  logTerminalSmokeHostWakeDiagnostic(
    'report-failed',
    source,
    `event=${event} error=${JSON.stringify(message)}`,
  )
}

export function reportTerminalSmokeHostWakeStage(
  reportHostWake: TerminalSmokeHostWakeReporter | undefined,
  event: TerminalSmokeHostWakeEvent,
  source: TerminalSmokeHostWakeSource,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new Error('Terminal smoke host wake was aborted'),
    )
  }
  if (!reportHostWake) {
    return Promise.reject(
      new Error('Terminal smoke host wake reporter is unavailable'),
    )
  }
  const abortError = () =>
    signal?.reason instanceof Error
      ? signal.reason
      : new Error('Terminal smoke host wake was aborted')
  const previous = reporterInFlight.get(reportHostWake)
  let abandoned = false
  const operation = Promise.resolve().then(async () => {
    if (previous) await previous.catch(() => {})
    if (abandoned) {
      throw signal?.aborted
        ? abortError()
        : new Error(
            `Host wake reporter timed out after ${TERMINAL_SMOKE_HOST_WAKE_REPORT_TIMEOUT_MS} ms`,
          )
    }
    await reportHostWake(event, source)
  })
  reporterInFlight.set(reportHostWake, operation)
  void operation.then(
    () => {
      if (reporterInFlight.get(reportHostWake) === operation)
        reporterInFlight.delete(reportHostWake)
    },
    () => {
      if (reporterInFlight.get(reportHostWake) === operation)
        reporterInFlight.delete(reportHostWake)
    },
  )
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let abortHandler: (() => void) | null = null
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        abandoned = true
        reject(
          new Error(
            `Host wake reporter timed out after ${TERMINAL_SMOKE_HOST_WAKE_REPORT_TIMEOUT_MS} ms`,
          ),
        )
      }, TERMINAL_SMOKE_HOST_WAKE_REPORT_TIMEOUT_MS)
    }),
    ...(signal
      ? [
          new Promise<never>((_, reject) => {
            abortHandler = () => {
              abandoned = true
              reject(abortError())
            }
            if (signal.aborted) abortHandler()
            else signal.addEventListener('abort', abortHandler, { once: true })
          }),
        ]
      : []),
  ]).finally(() => {
    if (timeoutId !== null) clearTimeout(timeoutId)
    if (signal && abortHandler)
      signal.removeEventListener('abort', abortHandler)
  })
}

export function requestTerminalSmokeHostWakeCheckpoint(
  hostWakeSentRef: { current: boolean },
  hostWakeInFlightRef: { current: Promise<void> | null },
  reportHostWake?: TerminalSmokeHostWakeReporter,
  source: TerminalSmokeHostWakeSource = 'retryable-error',
  signal?: AbortSignal,
): Promise<void> {
  if (hostWakeSentRef.current) return Promise.resolve()
  if (hostWakeInFlightRef.current) return hostWakeInFlightRef.current
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new Error('Terminal smoke host wake was aborted'),
    )
  }
  logTerminalSmokeHostWakeDiagnostic('request-start', source)
  const request = Promise.resolve()
    .then(async () => {
      logTerminalSmokeHostWakeDiagnostic('reporter-invoke', source)
      await reportTerminalSmokeHostWakeStage(
        reportHostWake,
        'checkpoint',
        source,
        signal,
      )
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error('Terminal smoke host wake was aborted')
      }
      terminalSessionManager.handleHostWake()
      hostWakeSentRef.current = true
    })
    .then(
      () => logTerminalSmokeHostWakeDiagnostic('reporter-resolved', source),
      error => {
        const message = error instanceof Error ? error.message : String(error)
        logTerminalSmokeHostWakeDiagnostic(
          'reporter-rejected',
          source,
          `error=${JSON.stringify(message)}`,
        )
        throw error
      },
    )
    .finally(() => {
      if (hostWakeInFlightRef.current === request)
        hostWakeInFlightRef.current = null
    })
  hostWakeInFlightRef.current = request
  return request
}
