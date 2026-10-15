import { useEffect } from 'react'
import { terminalSessionManager } from '@/features/terminal/services/terminal-session-manager'
import type { Terminal } from '@baicie/xterm'
import type { TerminalSmokeConfig, TerminalSmokeResult } from './terminal-smoke-contract'
import { terminalSmokeRoundFailure } from './terminal-smoke-results'

interface TerminalSmokeRecoveryOptions {
  completeOnce: (sessionId: string | null, result: TerminalSmokeResult) => void
  config: TerminalSmokeConfig
  controller: AbortController
  error: string | null
  hostWakeSentRef: { current: boolean }
  reportHostWake?: () => Promise<void>
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
  reportHostWake,
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
    if (!['error', 'disconnected', 'reconnecting'].includes(status)) return
    // `reconnecting` before the first connection came up is the first-connect
    // ladder walking. The session never had a session id to lose, so no round
    // is running and nothing should be failed: the manager is correctly riding
    // out a host that has not answered yet, which is the whole point of the
    // automatic retry budget. Treating it as terminal made every case whose
    // host is unreachable at connect time fail, while the overall smoke
    // deadline still bounds how long this can wait.
    if (status === 'reconnecting' && !startedRef.current) return
    if (requiresReconnect && status === 'reconnecting') {
      reconnectObservedRef.current = true
      reconnectStartedAtRef.current ??= performance.now()
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
    if (requiresReconnect && reconnectObservedRef.current && status === 'disconnected') return
    if (
      config.hostWakeRequired &&
      requiresReconnect &&
      status === 'error' &&
      retryable === true &&
      !hostWakeSentRef.current
    ) {
      hostWakeSentRef.current = true
      void (async () => {
        terminalSessionManager.handleHostWake()
        await reportHostWake?.()
      })()
      return
    }
    const connectionError = new Error(error ?? `Terminal smoke session ${status}`)
    if (startedRef.current) controller.abort(connectionError)
    else completeOnce(sessionId, terminalSmokeRoundFailure(term, config, connectionError))
  }, [
    completeOnce,
    config,
    controller,
    error,
    hostWakeSentRef,
    reportHostWake,
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
