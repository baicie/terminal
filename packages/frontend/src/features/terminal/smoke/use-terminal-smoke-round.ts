import { Terminal } from '@baicie/xterm'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { terminalSessionManager } from '@/features/terminal/services/terminal-session-manager'
import { useTerminal } from '@/hooks/use-terminal'
import { runTerminalSmoke } from './run-terminal-smoke'
import { collectTerminalSmokeDiagnostics } from './terminal-smoke-diagnostics'
import type {
  TerminalSmokeConfig,
  TerminalSmokeResult,
  TerminalSmokeStaleOutputProbe,
} from './terminal-smoke-contract'
import { terminalSmokeRoundFailure } from './terminal-smoke-results'
import {
  terminalSmokeRequest,
  terminalSmokeTabId,
} from './terminal-smoke-round-request'

const CONNECTION_DEADLINE_MS = 10_000
const RECONNECT_DEADLINE_MS = 30_000

export interface UseTerminalSmokeRoundOptions {
  applicationStartedAt: number
  config: TerminalSmokeConfig
  roundIndex: number
  signal: AbortSignal
  reportConnected: () => Promise<number>
  reportReconnect: () => Promise<void>
  emitStaleOutput: (
    retiredSessionId: string,
    activeSessionId: string,
  ) => Promise<TerminalSmokeStaleOutputProbe>
  onComplete: (
    roundIndex: number,
    tabId: string,
    sessionIds: string[],
    result: TerminalSmokeResult,
  ) => void
}

export function useTerminalSmokeRound({
  applicationStartedAt,
  config,
  roundIndex,
  signal,
  reportConnected,
  reportReconnect,
  emitStaleOutput,
  onComplete,
}: UseTerminalSmokeRoundOptions) {
  const tabId = terminalSmokeTabId(roundIndex)
  const requiresReconnect = config.reconnectRequired && roundIndex === 0
  const containerRef = useRef<HTMLDivElement>(null)
  const rawOutputTailRef = useRef('')
  const startedRef = useRef(false)
  const completedRef = useRef(false)
  const reconnectObservedRef = useRef(false)
  const reconnectCheckpointSentRef = useRef(false)
  const reconnectStartedAtRef = useRef<number | null>(null)
  const runControllerRef = useRef<AbortController | null>(null)
  const initialSessionIdRef = useRef<string | null>(null)
  const runningSessionIdRef = useRef<string | null>(null)
  const firstConnectionMsRef = useRef(0)
  const onCompleteRef = useRef(onComplete)
  const [controller] = useState(() => new AbortController())
  const [term] = useState(
    () =>
      new Terminal({
        cols: config.initialCols,
        rows: config.initialRows,
        cursorBlink: false,
        scrollback: 2_000,
      }),
  )
  const {
    sessionId,
    status,
    error,
    getInputDiagnostics,
    getOutputDiagnostics,
  } = useTerminal(term, {
    ...terminalSmokeRequest(config, roundIndex),
    onOutput: event => {
      rawOutputTailRef.current = `${rawOutputTailRef.current}${event.data}`.slice(
        -4096,
      )
    },
  })
  const statusRef = useRef(status)
  statusRef.current = status
  onCompleteRef.current = onComplete

  const completeOnce = useCallback(
    (activeSessionId: string | null, result: TerminalSmokeResult) => {
      if (completedRef.current) return
      completedRef.current = true
      const sessionIds: string[] = []
      const initialSessionId = initialSessionIdRef.current
      if (requiresReconnect && initialSessionId) sessionIds.push(initialSessionId)
      if (activeSessionId && !sessionIds.includes(activeSessionId)) {
        sessionIds.push(activeSessionId)
      }
      onCompleteRef.current(roundIndex, tabId, sessionIds, {
        ...result,
        firstConnectionMs: firstConnectionMsRef.current,
      })
    },
    [requiresReconnect, roundIndex, tabId],
  )

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    term.open(container)
    term.focus()
    return () => {
      controller.abort(new Error('Terminal smoke round unmounted'))
      runControllerRef.current?.abort(new Error('Terminal smoke round unmounted'))
      void terminalSessionManager
        .close(tabId)
        .catch(closeError => {
          console.error('Failed to close terminal smoke session:', closeError)
        })
        .then(() => term.dispose())
    }
  }, [controller, tabId, term])

  useEffect(() => {
    const abort = () => controller.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    return () => signal.removeEventListener('abort', abort)
  }, [controller, signal])

  useEffect(() => {
    if (status !== 'connected' || !sessionId || completedRef.current) return
    const isReconnect = reconnectObservedRef.current
    if (runningSessionIdRef.current === sessionId) return
    if (requiresReconnect && !isReconnect && reconnectCheckpointSentRef.current) {
      return
    }
    if (initialSessionIdRef.current === null) initialSessionIdRef.current = sessionId
    if (isReconnect && initialSessionIdRef.current === sessionId) {
      completeOnce(
        sessionId,
        terminalSmokeRoundFailure(
          term,
          config,
          new Error('Terminal smoke reconnect reused the retired session ID'),
        ),
      )
      return
    }
    startedRef.current = true
    if (isReconnect) {
      term.reset()
      rawOutputTailRef.current = ''
    }

    const run = async (activeSessionId: string) => {
      const runController = new AbortController()
      runControllerRef.current = runController
      const abortRun = () => runController.abort(controller.signal.reason)
      controller.signal.addEventListener('abort', abortRun, { once: true })
      try {
        const result = await runTerminalSmoke(term, config, {
          signal: runController.signal,
          ...(isReconnect
            ? {
                staleOutputProbe: () => {
                  const retiredSessionId = initialSessionIdRef.current
                  if (!retiredSessionId) {
                    throw new Error(
                      'Terminal smoke retired session ID is unavailable',
                    )
                  }
                  return emitStaleOutput(retiredSessionId, activeSessionId)
                },
              }
            : {}),
          diagnostics: () =>
            collectTerminalSmokeDiagnostics(
              term,
              getInputDiagnostics,
              getOutputDiagnostics,
              () => rawOutputTailRef.current,
            ),
        })
        if (requiresReconnect && !reconnectObservedRef.current) return
        completeOnce(activeSessionId, {
          ...result,
          reconnectObserved: reconnectObservedRef.current,
        })
      } catch (runError) {
        if (reconnectObservedRef.current && statusRef.current !== 'error') return
        completeOnce(activeSessionId, terminalSmokeRoundFailure(term, config, runError))
      } finally {
        controller.signal.removeEventListener('abort', abortRun)
        if (runControllerRef.current === runController) {
          runControllerRef.current = null
        }
      }
    }

    void (async () => {
      try {
        if (roundIndex === 0 && !isReconnect) {
          const elapsedMs = await reportConnected()
          if (
            Number.isSafeInteger(elapsedMs) &&
            elapsedMs > 0 &&
            firstConnectionMsRef.current === 0
          ) {
            firstConnectionMsRef.current = elapsedMs
          }
          if (requiresReconnect && !reconnectCheckpointSentRef.current) {
            reconnectCheckpointSentRef.current = true
            await reportReconnect()
            return
          }
        }
        if (controller.signal.aborted) throw controller.signal.reason
        runningSessionIdRef.current = sessionId
        await run(sessionId)
      } catch (runError) {
        completeOnce(sessionId, terminalSmokeRoundFailure(term, config, runError))
      }
    })()
  }, [
    completeOnce,
    config,
    controller,
    emitStaleOutput,
    getInputDiagnostics,
    getOutputDiagnostics,
    reportConnected,
    reportReconnect,
    requiresReconnect,
    roundIndex,
    sessionId,
    status,
    term,
  ])

  useEffect(() => {
    if (!['error', 'disconnected', 'reconnecting'].includes(status)) return
    if (requiresReconnect && startedRef.current && status === 'reconnecting') {
      reconnectObservedRef.current = true
      reconnectStartedAtRef.current ??= performance.now()
      runControllerRef.current?.abort(new Error('SSH session reconnecting'))
      return
    }
    if (requiresReconnect && reconnectObservedRef.current && status === 'disconnected') {
      return
    }
    const connectionError = new Error(error ?? `Terminal smoke session ${status}`)
    if (startedRef.current) controller.abort(connectionError)
    else completeOnce(sessionId, terminalSmokeRoundFailure(term, config, connectionError))
  }, [completeOnce, config, controller, error, requiresReconnect, sessionId, status, term])

  useEffect(() => {
    const reconnecting = requiresReconnect && reconnectObservedRef.current
    const waiting = reconnecting
      ? status === 'reconnecting' || status === 'connecting'
      : status === 'idle' || status === 'connecting'
    if (!waiting) return
    const roundStartedAt = reconnecting
      ? (reconnectStartedAtRef.current ?? performance.now())
      : roundIndex === 0
        ? applicationStartedAt
        : performance.now()
    const deadlineMs = reconnecting ? RECONNECT_DEADLINE_MS : CONNECTION_DEADLINE_MS
    const remainingMs = Math.max(0, deadlineMs - (performance.now() - roundStartedAt))
    const timer = setTimeout(() => {
      completeOnce(
        sessionId,
        terminalSmokeRoundFailure(
          term,
          config,
          new Error(
            `Terminal smoke did not connect within ${deadlineMs} ms (status: ${status})`,
          ),
        ),
      )
    }, remainingMs)
    return () => clearTimeout(timer)
  }, [applicationStartedAt, completeOnce, config, roundIndex, requiresReconnect, sessionId, status, term])

  return containerRef
}
