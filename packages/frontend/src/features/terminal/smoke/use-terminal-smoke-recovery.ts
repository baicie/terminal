import { useEffect } from 'react'
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
} from './use-terminal-smoke-host-wake-fallback'

interface TerminalSmokeRecoveryOptions {
  completeOnce: (sessionId: string | null, result: TerminalSmokeResult) => void
  config: TerminalSmokeConfig
  controller: AbortController
  error: string | null
  hostWakeSentRef: { current: boolean }
  hostWakeInFlightRef: { current: Promise<void> | null }
  reportHostWake?: TerminalSmokeHostWakeReporter
  reconnectCheckpointSentRef: { current: boolean }
  reconnectObservedRef: { current: boolean }
  reconnectStartedAtRef: { current: number | null }
  requiresReconnect: boolean
  retryable?: boolean
  runControllerRef: { current: AbortController | null }
  sessionId: string | null
  startedRef: { current: boolean }
  status: string
  term: Terminal
}

export function useTerminalSmokeRecovery({
  completeOnce,
  config,
  controller,
  error,
  hostWakeSentRef,
  hostWakeInFlightRef,
  reportHostWake,
  reconnectCheckpointSentRef,
  reconnectObservedRef,
  reconnectStartedAtRef,
  requiresReconnect,
  retryable,
  runControllerRef,
  sessionId,
  startedRef,
  status,
  term,
}: TerminalSmokeRecoveryOptions): void {
  useEffect(() => {
    if (!config.hostWakeRequired) return
    const reportAbort = () => {
      logTerminalSmokeHostWakeDiagnostic(
        'controller-aborted',
        'reconnect-state-recovery',
      )
      // The abort event is emitted after the signal is aborted. Do not start a
      // late Tauri IPC diagnostic while the round is being destroyed.
      if (controller.signal.aborted) return
      void reportTerminalSmokeHostWakeStage(
        reportHostWake,
        'round-controller-aborted',
        'reconnect-state-recovery',
        controller.signal,
      ).catch(error =>
        logTerminalSmokeHostWakeReportFailure(
          'round-controller-aborted',
          'reconnect-state-recovery',
          error,
        ),
      )
    }
    if (controller.signal.aborted) {
      reportAbort()
      return
    }
    controller.signal.addEventListener('abort', reportAbort, { once: true })
    return () => controller.signal.removeEventListener('abort', reportAbort)
  }, [config.hostWakeRequired, controller, reportHostWake])

  useEffect(() => {
    if (!['error', 'disconnected', 'reconnecting'].includes(status)) return
    if (controller.signal.aborted) return
    console.info(
      `[terminal-smoke-recovery] status=${status} session=${sessionId ?? 'none'} ` +
        `checkpoint=${reconnectCheckpointSentRef.current} observed=${reconnectObservedRef.current}`,
    )
    // `reconnecting` before the first connection came up is the first-connect
    // ladder walking. The session never had a session id to lose, so no round
    // is running and nothing should be failed: the manager is correctly riding
    // out a host that has not answered yet, which is the whole point of the
    // automatic retry budget. Treating it as terminal made every case whose
    // host is unreachable at connect time fail, while the overall smoke
    // deadline still bounds how long this can wait.
    if (status === 'reconnecting' && !startedRef.current) return
    const failHostWakeCheckpoint = (wakeError: unknown) => {
      if (controller.signal.aborted) return
      const message =
        wakeError instanceof Error ? wakeError.message : String(wakeError)
      const failure = new Error(
        `Failed to publish terminal smoke host wake checkpoint: ${message}`,
      )
      completeOnce(sessionId, terminalSmokeRoundFailure(term, config, failure))
      controller.abort(failure)
      runControllerRef.current?.abort(failure)
    }
    if (requiresReconnect && status === 'reconnecting') {
      reconnectObservedRef.current = true
      reconnectStartedAtRef.current ??= performance.now()
      if (config.hostWakeRequired && !hostWakeSentRef.current) {
        const elapsed = Math.max(
          0,
          performance.now() - reconnectStartedAtRef.current,
        )
        const delayMs = Math.max(
          0,
          TERMINAL_SMOKE_HOST_WAKE_TRIGGER_MS - elapsed,
        )
        logTerminalSmokeHostWakeDiagnostic(
          'timer-armed',
          'reconnect-state-recovery',
          `delayMs=${delayMs}`,
        )
        void reportTerminalSmokeHostWakeStage(
          reportHostWake,
          'reconnect-state-timer-armed',
          'reconnect-state-recovery',
          controller.signal,
        ).catch(failHostWakeCheckpoint)
        let timerFired = false
        const timer = setTimeout(() => {
          timerFired = true
          logTerminalSmokeHostWakeDiagnostic(
            'timer-fired',
            'reconnect-state-recovery',
          )
          void (async () => {
            await reportTerminalSmokeHostWakeStage(
              reportHostWake,
              'reconnect-state-timer-fired',
              'reconnect-state-recovery',
              controller.signal,
            )
            await requestTerminalSmokeHostWakeCheckpoint(
              hostWakeSentRef,
              hostWakeInFlightRef,
              reportHostWake,
              'reconnect-state-recovery',
              controller.signal,
            )
          })().catch(failHostWakeCheckpoint)
        }, delayMs)
        if (startedRef.current) {
          runControllerRef.current?.abort(new Error('SSH session reconnecting'))
        }
        return () => {
          clearTimeout(timer)
          if (!timerFired) {
            logTerminalSmokeHostWakeDiagnostic(
              'timer-cleared',
              'reconnect-state-recovery',
            )
            void reportTerminalSmokeHostWakeStage(
              reportHostWake,
              'reconnect-state-timer-cleared',
              'reconnect-state-recovery',
              controller.signal,
            ).catch(error =>
              logTerminalSmokeHostWakeReportFailure(
                'reconnect-state-timer-cleared',
                'reconnect-state-recovery',
                error,
              ),
            )
          }
        }
      }
      // A retry that starts before the first connection ever came up is the
      // first-connect ladder walking, not a finished round: the session had no
      // session id to lose, so nothing is running yet and there is nothing to
      // abort. Reporting a failure here would fail every case whose host is
      // unreachable at connect time -- exactly the case the ladder exists to
      // survive. The overall smoke deadline still bounds the wait.
      if (startedRef.current) {
        runControllerRef.current?.abort(new Error('SSH session reconnecting'))
      }
      return
    }
    if (
      requiresReconnect &&
      reconnectCheckpointSentRef.current &&
      status === 'disconnected'
    )
      return
    if (
      config.hostWakeRequired &&
      requiresReconnect &&
      status === 'error' &&
      retryable !== false &&
      !hostWakeSentRef.current
    ) {
      void requestTerminalSmokeHostWakeCheckpoint(
        hostWakeSentRef,
        hostWakeInFlightRef,
        reportHostWake,
        'retryable-error',
        controller.signal,
      ).catch(failHostWakeCheckpoint)
      return
    }
    const connectionError = new Error(
      error ?? `Terminal smoke session ${status}`,
    )
    if (startedRef.current) controller.abort(connectionError)
    else
      completeOnce(
        sessionId,
        terminalSmokeRoundFailure(term, config, connectionError),
      )
  }, [
    completeOnce,
    config,
    controller,
    error,
    hostWakeSentRef,
    hostWakeInFlightRef,
    reportHostWake,
    reconnectCheckpointSentRef,
    reconnectObservedRef,
    reconnectStartedAtRef,
    requiresReconnect,
    retryable,
    runControllerRef,
    sessionId,
    startedRef,
    status,
    term,
  ])
}
