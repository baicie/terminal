import { useCallback, useEffect, useRef, useState } from 'react'
import { terminalSessionManager } from '@/features/terminal/services/terminal-session-manager'
import type {
  TerminalSmokeConfig,
  TerminalSmokeResult,
} from './terminal-smoke-contract'
import { terminalSmokeTabId } from './terminal-smoke-round-request'
import {
  terminalSmokeFailure,
  terminalSmokeSuccess,
} from './terminal-smoke-results'
import {
  waitForStableTerminalSmokeResources,
  type TerminalSmokeResourceSnapshot,
} from './terminal-smoke-resources'

const RUST_DEADLINE_RESERVE_MS = 15_000

export function useTerminalSmokeOrchestrator(
  config: TerminalSmokeConfig,
  submitResult: (result: TerminalSmokeResult) => Promise<void>,
  /**
   * F13 — resolves once the injected reconnect policy is applied, if one was injected.
   *
   * Awaited at the one point where the order actually matters: immediately before
   * `roundIndex` becomes 0, which is what mounts the first round and opens its connection.
   * It is deliberately not a render gate — an ordinary run has no policy, and making every
   * run wait a round-trip to learn that also stalled the lifecycle tests, which have no IPC
   * to answer the call.
   */
  policyReady: Promise<void> = Promise.resolve(),
) {
  const applicationStartedAtRef = useRef(performance.now())
  const [controller] = useState(() => new AbortController())
  const baselineRef = useRef<TerminalSmokeResourceSnapshot | null>(null)
  const resultsRef = useRef<TerminalSmokeResult[]>([])
  const sessionIdsRef = useRef(new Set<string>())
  const submittedRef = useRef(false)
  const completingRef = useRef(false)
  const currentTabRef = useRef<string | null>(null)
  const [roundIndex, setRoundIndex] = useState<number | null>(null)

  const submitOnce = useCallback(
    (result: TerminalSmokeResult) => {
      if (submittedRef.current) return
      submittedRef.current = true
      void submitResult(result).catch(submitError => {
        console.error('Failed to submit terminal smoke result:', submitError)
      })
    },
    [submitResult],
  )

  useEffect(() => {
    const frontendDeadlineMs = Math.max(
      1,
      config.timeoutMs - RUST_DEADLINE_RESERVE_MS,
    )
    const timeout = setTimeout(
      () => controller.abort(new Error('Terminal smoke timed out')),
      frontendDeadlineMs,
    )
    void waitForStableTerminalSmokeResources(undefined, {
      signal: controller.signal,
    })
      .then(async baseline => {
        if (controller.signal.aborted) return
        baselineRef.current = baseline
        // The injected policy must be in place before the first connection opens; see the
        // parameter's comment for why this is the only place that waits on it.
        await policyReady
        if (controller.signal.aborted) return
        setRoundIndex(0)
      })
      .catch(error => {
        submitOnce(
          terminalSmokeFailure(
            config,
            applicationStartedAtRef.current,
            'resources',
            error,
            {
              resourcesRecovered: false,
              roundsCompleted: 0,
              uniqueSessionCount: 0,
            },
          ),
        )
      })
    return () => {
      clearTimeout(timeout)
      controller.abort(new Error('Terminal smoke root unmounted'))
      const tabId = currentTabRef.current
      if (tabId) void terminalSessionManager.close(tabId)
    }
  }, [config, controller, policyReady, submitOnce])

  const completeRound = useCallback(
    async (
      completedRound: number,
      tabId: string,
      sessionIds: string[],
      result: TerminalSmokeResult,
    ) => {
      if (completingRef.current || submittedRef.current) return
      completingRef.current = true
      const baseline = baselineRef.current
      const roundSessionIds = new Set(sessionIds)
      const duplicateSession =
        roundSessionIds.size !== sessionIds.length ||
        sessionIds.some(sessionId => sessionIdsRef.current.has(sessionId))
      for (const sessionId of roundSessionIds) {
        sessionIdsRef.current.add(sessionId)
      }
      try {
        await terminalSessionManager.close(tabId)
        if (!baseline) throw new Error('Terminal smoke baseline is unavailable')
        await waitForStableTerminalSmokeResources(undefined, {
          expected: baseline,
          signal: controller.signal,
        })
      } catch (error) {
        const roundFailed = !result.ok
        submitOnce(
          terminalSmokeFailure(
            config,
            applicationStartedAtRef.current,
            roundFailed ? result.stage : 'resources',
            roundFailed
              ? (result.error ?? 'Terminal smoke round failed')
              : error,
            {
              result,
              resourcesRecovered: false,
              roundsCompleted: resultsRef.current.length,
              uniqueSessionCount: sessionIdsRef.current.size,
            },
          ),
        )
        return
      }

      if (!result.ok || duplicateSession || sessionIds.length === 0) {
        const failure = !result.ok
          ? result.error ?? 'Terminal smoke round failed'
          : duplicateSession
            ? 'Terminal smoke reused a session ID'
            : 'Terminal smoke connected without a session ID'
        submitOnce(
          terminalSmokeFailure(
            config,
            applicationStartedAtRef.current,
            result.ok ? 'resources' : result.stage,
            failure,
            {
              result,
              resourcesRecovered: true,
              roundsCompleted: resultsRef.current.length,
              uniqueSessionCount: sessionIdsRef.current.size,
            },
          ),
        )
        return
      }

      resultsRef.current.push(result)
      if (completedRound + 1 === config.rounds) {
        submitOnce(
          terminalSmokeSuccess(
            config,
            applicationStartedAtRef.current,
            resultsRef.current,
            sessionIdsRef.current.size,
          ),
        )
        return
      }
      completingRef.current = false
      setRoundIndex(completedRound + 1)
    },
    [config, controller.signal, submitOnce],
  )

  currentTabRef.current =
    roundIndex === null ? null : terminalSmokeTabId(roundIndex)
  return {
    applicationStartedAt: applicationStartedAtRef.current,
    completeRound,
    roundIndex,
    signal: controller.signal,
  }
}
