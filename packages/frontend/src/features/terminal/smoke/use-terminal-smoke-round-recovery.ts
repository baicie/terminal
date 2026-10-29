import { useCallback } from 'react'
import type { Terminal } from '@baicie/xterm'
import type {
  TerminalSmokeConfig,
  TerminalSmokeHostWakeReporter,
  TerminalSmokeResult,
} from './terminal-smoke-contract'
import { terminalSmokeRoundFailure } from './terminal-smoke-results'
import { useTerminalSmokeDeadline } from './use-terminal-smoke-deadline'
import { useTerminalSmokeRecovery } from './use-terminal-smoke-recovery'

interface TerminalSmokeRoundRecoveryOptions {
  applicationStartedAt: number
  completeOnce: (sessionId: string | null, result: TerminalSmokeResult) => void
  config: TerminalSmokeConfig
  controller: AbortController
  error: string | null
  hostWakeSentRef: { current: boolean }
  hostWakeInFlightRef: { current: Promise<void> | null }
  reconnectObservedRef: { current: boolean }
  reconnectCheckpointSentRef: { current: boolean }
  reconnectStartedAtRef: { current: number | null }
  reportHostWake?: TerminalSmokeHostWakeReporter
  requiresReconnect: boolean
  retryable?: boolean
  roundIndex: number
  runControllerRef: { current: AbortController | null }
  sessionId: string | null
  startedRef: { current: boolean }
  status: string
  term: Terminal
}

export function useTerminalSmokeRoundRecovery({
  applicationStartedAt,
  completeOnce,
  config,
  controller,
  error,
  hostWakeSentRef,
  hostWakeInFlightRef,
  reconnectObservedRef,
  reconnectCheckpointSentRef,
  reconnectStartedAtRef,
  reportHostWake,
  requiresReconnect,
  retryable,
  roundIndex,
  runControllerRef,
  sessionId,
  startedRef,
  status,
  term,
}: TerminalSmokeRoundRecoveryOptions): void {
  useTerminalSmokeRecovery({
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
  })

  const onDeadline = useCallback(
    (deadlineMs: number, currentStatus: string) => {
      completeOnce(
        sessionId,
        terminalSmokeRoundFailure(
          term,
          config,
          new Error(
            `Terminal smoke did not connect within ${deadlineMs} ms (status: ${currentStatus})`,
          ),
        ),
      )
    },
    [completeOnce, config, sessionId, term],
  )
  useTerminalSmokeDeadline({
    applicationStartedAt,
    onTimeout: onDeadline,
    reconnectRequired: requiresReconnect,
    hostWakeRequired: config.hostWakeRequired,
    reconnectObservedRef,
    reconnectStartedAtRef,
    roundIndex,
    sessionId,
    status,
  })
}
