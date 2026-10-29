import { useCallback, useEffect, useRef } from 'react'
import type { Terminal } from '@baicie/xterm'
import type {
  TerminalSmokeConfig,
  TerminalSmokeHostWakeReporter,
  TerminalSmokeResult,
} from './terminal-smoke-contract'
import { terminalSmokeRoundFailure } from './terminal-smoke-results'
import {
  logTerminalSmokeHostWakeDiagnostic,
  logTerminalSmokeHostWakeReportFailure,
  reportTerminalSmokeHostWakeStage,
  requestTerminalSmokeHostWakeCheckpoint,
  TERMINAL_SMOKE_HOST_WAKE_TRIGGER_MS,
} from './terminal-smoke-host-wake'

const TERMINAL_SMOKE_HOST_WAKE_POLL_MS = 250
const TERMINAL_SMOKE_HOST_WAKE_DIAGNOSTIC_POLL_MS = 5_000

export {
  logTerminalSmokeHostWakeDiagnostic,
  logTerminalSmokeHostWakeReportFailure,
  reportTerminalSmokeHostWakeStage,
  requestTerminalSmokeHostWakeCheckpoint,
  TERMINAL_SMOKE_HOST_WAKE_REPORT_TIMEOUT_MS,
  TERMINAL_SMOKE_HOST_WAKE_TRIGGER_MS,
} from './terminal-smoke-host-wake'
export type { TerminalSmokeHostWakeSource } from './terminal-smoke-host-wake'

interface HostWakeFallbackOptions {
  completeOnce: (sessionId: string | null, result: TerminalSmokeResult) => void
  config: TerminalSmokeConfig
  controller: AbortController
  hostWakeSentRef: { current: boolean }
  hostWakeInFlightRef: { current: Promise<void> | null }
  reportHostWake?: TerminalSmokeHostWakeReporter
  runControllerRef: { current: AbortController | null }
  runningSessionIdRef: { current: string | null }
  term: Terminal
}

export function useTerminalSmokeHostWakeFallback({
  completeOnce,
  config,
  controller,
  hostWakeSentRef,
  hostWakeInFlightRef,
  reportHostWake,
  runControllerRef,
  runningSessionIdRef,
  term,
}: HostWakeFallbackOptions): () => void {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerStartedAtRef = useRef<number | null>(null)
  const timerFiredRef = useRef(false)
  const timerClearedRef = useRef(false)

  const failHostWakeCheckpoint = useCallback(
    (wakeError: unknown) => {
      if (controller.signal.aborted) return
      const message =
        wakeError instanceof Error ? wakeError.message : String(wakeError)
      const failure = new Error(
        `Failed to publish terminal smoke host wake checkpoint: ${message}`,
      )
      completeOnce(
        runningSessionIdRef.current,
        terminalSmokeRoundFailure(term, config, failure),
      )
      controller.abort(failure)
      runControllerRef.current?.abort(failure)
    },
    [
      completeOnce,
      config,
      controller,
      runControllerRef,
      runningSessionIdRef,
      term,
    ],
  )

  const clearFallbackTimer = useCallback(
    (reason: string) => {
      if (timerRef.current === null) return
      clearInterval(timerRef.current)
      timerRef.current = null
      if (timerFiredRef.current || timerClearedRef.current) return
      timerClearedRef.current = true
      logTerminalSmokeHostWakeDiagnostic(
        'timer-cleared',
        'reconnect-checkpoint-fallback',
        `reason=${reason}`,
      )
      void reportTerminalSmokeHostWakeStage(
        reportHostWake,
        'fallback-timer-cleared',
        'reconnect-checkpoint-fallback',
        controller.signal,
      ).catch(error =>
        logTerminalSmokeHostWakeReportFailure(
          'fallback-timer-cleared',
          'reconnect-checkpoint-fallback',
          error,
        ),
      )
    },
    [controller, reportHostWake],
  )

  const onReconnectCheckpoint = useCallback(() => {
    if (
      !config.hostWakeRequired ||
      hostWakeSentRef.current ||
      timerRef.current !== null
    ) {
      return
    }
    if (timerRef.current !== null) return
    timerStartedAtRef.current = performance.now()
    timerFiredRef.current = false
    timerClearedRef.current = false
    let nextPollAtMs = 0
    let inFlightPollReported = false
    logTerminalSmokeHostWakeDiagnostic(
      'timer-armed',
      'reconnect-checkpoint-fallback',
      `delayMs=${TERMINAL_SMOKE_HOST_WAKE_TRIGGER_MS}`,
    )
    void reportTerminalSmokeHostWakeStage(
      reportHostWake,
      'fallback-armed',
      'reconnect-checkpoint-fallback',
      controller.signal,
    ).catch(failHostWakeCheckpoint)
    timerRef.current = setInterval(() => {
      const startedAt = timerStartedAtRef.current
      const elapsedMs =
        startedAt === null
          ? Number.POSITIVE_INFINITY
          : performance.now() - startedAt
      if (elapsedMs >= nextPollAtMs) {
        nextPollAtMs = elapsedMs + TERMINAL_SMOKE_HOST_WAKE_DIAGNOSTIC_POLL_MS
        void reportTerminalSmokeHostWakeStage(
          reportHostWake,
          'fallback-poll',
          'reconnect-checkpoint-fallback',
          controller.signal,
        ).catch(error =>
          logTerminalSmokeHostWakeDiagnostic(
            'poll-report-failed',
            'reconnect-checkpoint-fallback',
            `error=${JSON.stringify(error instanceof Error ? error.message : String(error))}`,
          ),
        )
      }
      if (hostWakeSentRef.current || controller.signal.aborted) {
        clearFallbackTimer(
          controller.signal.aborted ? 'controller-aborted' : 'host-wake-sent',
        )
        return
      }
      if (hostWakeInFlightRef.current !== null) {
        if (!inFlightPollReported) {
          inFlightPollReported = true
          void reportTerminalSmokeHostWakeStage(
            reportHostWake,
            'fallback-poll-in-flight',
            'reconnect-checkpoint-fallback',
            controller.signal,
          ).catch(error =>
            logTerminalSmokeHostWakeDiagnostic(
              'in-flight-poll-report-failed',
              'reconnect-checkpoint-fallback',
              `error=${JSON.stringify(error instanceof Error ? error.message : String(error))}`,
            ),
          )
        }
        return
      }
      if (
        startedAt === null ||
        elapsedMs < TERMINAL_SMOKE_HOST_WAKE_TRIGGER_MS
      ) {
        return
      }
      timerFiredRef.current = true
      if (timerRef.current !== null) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      logTerminalSmokeHostWakeDiagnostic(
        'timer-fired',
        'reconnect-checkpoint-fallback',
      )
      void (async () => {
        await reportTerminalSmokeHostWakeStage(
          reportHostWake,
          'fallback-timer-fired',
          'reconnect-checkpoint-fallback',
          controller.signal,
        )
        await requestTerminalSmokeHostWakeCheckpoint(
          hostWakeSentRef,
          hostWakeInFlightRef,
          reportHostWake,
          'reconnect-checkpoint-fallback',
          controller.signal,
        )
      })().catch(failHostWakeCheckpoint)
    }, TERMINAL_SMOKE_HOST_WAKE_POLL_MS)
  }, [
    config.hostWakeRequired,
    controller,
    failHostWakeCheckpoint,
    hostWakeSentRef,
    hostWakeInFlightRef,
    reportHostWake,
    clearFallbackTimer,
  ])

  useEffect(
    () => () => {
      clearFallbackTimer('unmount')
    },
    [clearFallbackTimer],
  )

  return onReconnectCheckpoint
}
