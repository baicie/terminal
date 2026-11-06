import { useEffect } from 'react'
import { useAppStore } from './store/app'
import {
  startWorkspaceRecovery,
  type WorkspaceRecoveryHandle,
  type WorkspaceRecoveryObservation,
} from './service/workspace-recovery'
import { traceStage } from './service/database/startup-trace'
import { bootstrapNow } from './terminal-bootstrap-deadline'
import {
  decideStartupFallback,
  type FallbackDecision,
  type StartupLayoutState,
} from './startup-recovery-arbiter'

export const STARTUP_TERMINAL_FALLBACK_MS = 2_000
/**
 * Bounded grace after the fallback deadline while recovery is still active.
 *
 * This is deliberately not a second "fallback after N seconds" timer: it only
 * runs when recovery has not reached a definite decision yet, and it is capped
 * so a hung query cannot leave the window empty forever. The normal path still
 * clears the deadline timer before it fires.
 */
export const STARTUP_FALLBACK_DEFER_MS = 2_000
export const WORKSPACE_RECOVERY_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const

function hasUsableTerminal(
  tabs: ReadonlyArray<{ type: string; hostId?: string }>,
): boolean {
  return tabs.some(
    tab =>
      tab.type === 'local' ||
      // A restored remote tab owns its host id even while the host query is
      // still in flight (workspace recovery bounds that query at 1.5 s). The
      // fallback timer fires later, so requiring the loaded host list here used
      // to add a local tab on top of a perfectly restorable remote tab, steal
      // the active tab, and start a local session while the remote one was
      // still connecting. That is the "session created, no SSH stage" shape the
      // stress harness reported (Issue #179).
      (tab.type === 'remote' && Boolean(tab.hostId)),
  )
}

type RecoveryKnowledge = {
  active: boolean
  retryScheduled: boolean
  layoutState: StartupLayoutState
  correlationId: string | null
}

function knowledgeFromObservation(
  knowledge: RecoveryKnowledge,
  observation: WorkspaceRecoveryObservation,
): RecoveryKnowledge {
  const next = {
    ...knowledge,
    correlationId: observation.correlationId,
  }
  switch (observation.phase) {
    case 'workspace-load-start':
      return { ...next, active: true, layoutState: 'pending' }
    case 'workspace-load-done':
      return { ...next, layoutState: 'pending' }
    case 'workspace-load-failed':
      return { ...next, layoutState: 'failed' }
    case 'layout-load-start':
      return { ...next, layoutState: 'pending' }
    case 'layout-load-done':
    case 'recovery-layout-available':
    case 'restore-layout-committed':
      return { ...next, layoutState: 'known' }
    case 'layout-absent':
      return { ...next, layoutState: 'absent' }
    case 'layout-load-failed':
      return { ...next, layoutState: 'failed' }
    case 'restore-layout-skipped':
      return {
        ...next,
        layoutState: observation.reason === 'no-layout' ? 'absent' : 'known',
      }
    default:
      return next
  }
}

export function useStartupWorkspaceRecovery(
  startupTerminalFallbackAt?: number,
) {
  useEffect(() => {
    let disposed = false
    let recovery: WorkspaceRecoveryHandle | null = null
    let retryTimer: number | null = null
    let retryIndex = 0
    let activeRecoveryController: AbortController | null = null
    let fallbackDeadlineElapsed = false
    let fallbackOpened = false
    let fallbackTimer: number | null = null
    let deferTimer: number | null = null
    let deferBudgetElapsed = false
    const knowledge: RecoveryKnowledge = {
      active: false,
      retryScheduled: false,
      layoutState: 'unknown',
      correlationId: null,
    }
    const fallbackAt =
      startupTerminalFallbackAt ?? bootstrapNow() + STARTUP_TERMINAL_FALLBACK_MS

    const clearFallbackTimer = () => {
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer)
        fallbackTimer = null
      }
    }
    const clearDeferTimer = () => {
      if (deferTimer !== null) {
        window.clearTimeout(deferTimer)
        deferTimer = null
      }
    }
    const clearRetryTimer = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer)
        retryTimer = null
      }
    }
    const traceDecision = (trigger: string, decision: FallbackDecision) => {
      traceStage(
        'fallback-decision',
        [
          `action=${decision.action}`,
          `reason=${decision.reason}`,
          `trigger=${trigger}`,
          `layout=${knowledge.layoutState}`,
          `recoveryActive=${knowledge.active}`,
          `retryScheduled=${knowledge.retryScheduled}`,
          `correlationId=${knowledge.correlationId ?? 'none'}`,
        ].join(' '),
      )
    }
    const openFallback = () => {
      if (disposed || fallbackOpened) return
      if (hasUsableTerminal(useAppStore.getState().tabs)) return
      fallbackOpened = true
      useAppStore
        .getState()
        .addTab({ label: 'Local', type: 'local', startupFallback: true })
      traceStage(
        'fallback-opened',
        `correlationId=${knowledge.correlationId ?? 'none'}`,
      )
    }
    const armDeferTimer = () => {
      if (
        deferTimer !== null ||
        !fallbackDeadlineElapsed ||
        deferBudgetElapsed
      ) {
        return
      }
      deferTimer = window.setTimeout(() => {
        deferTimer = null
        deferBudgetElapsed = true
        traceStage(
          'fallback-defer-expired',
          `correlationId=${knowledge.correlationId ?? 'none'}`,
        )
        runDecision('defer-expired')
      }, STARTUP_FALLBACK_DEFER_MS)
    }
    const runDecision = (trigger: string) => {
      const decision = decideStartupFallback({
        deadlineElapsed: fallbackDeadlineElapsed,
        deferBudgetElapsed,
        recoveryActive: knowledge.active,
        retryScheduled: knowledge.retryScheduled,
        layoutState: knowledge.layoutState,
        usableTerminal: hasUsableTerminal(useAppStore.getState().tabs),
        fallbackOpened,
      })
      traceDecision(trigger, decision)
      if (decision.action === 'create') {
        clearDeferTimer()
        openFallback()
      } else if (decision.action === 'defer') {
        armDeferTimer()
      } else {
        clearDeferTimer()
      }
    }
    const applyObservation = (observation: WorkspaceRecoveryObservation) => {
      Object.assign(knowledge, knowledgeFromObservation(knowledge, observation))
      runDecision(`observation:${observation.phase}`)
    }

    fallbackTimer = window.setTimeout(
      () => {
        if (disposed) return
        fallbackTimer = null
        fallbackDeadlineElapsed = true
        traceStage(
          'fallback-deadline-reached',
          `correlationId=${knowledge.correlationId ?? 'none'} layout=${knowledge.layoutState}`,
        )
        runDecision('deadline')
      },
      Math.max(0, fallbackAt - bootstrapNow()),
    )

    const attemptRecovery = () => {
      if (disposed) return
      knowledge.active = true
      knowledge.retryScheduled = false
      const controller = new AbortController()
      activeRecoveryController = controller
      void startWorkspaceRecovery({
        signal: controller.signal,
        onObservation: applyObservation,
      })
        .then(handle => {
          if (disposed) {
            controller.abort()
            handle.dispose()
            return
          }
          if (activeRecoveryController === controller) {
            activeRecoveryController = null
          }
          knowledge.active = false
          recovery = handle
          clearRetryTimer()
          const hasUsableTerminalAfterRecovery = hasUsableTerminal(
            useAppStore.getState().tabs,
          )
          if (hasUsableTerminalAfterRecovery) {
            knowledge.layoutState = 'known'
            clearFallbackTimer()
            clearDeferTimer()
          }
          runDecision('recovery-settled')
        })
        .catch(() => {
          if (activeRecoveryController === controller) {
            activeRecoveryController = null
          }
          knowledge.active = false
          controller.abort()
          if (disposed) return
          const delay = WORKSPACE_RECOVERY_RETRY_DELAYS_MS[retryIndex]
          if (delay === undefined) {
            knowledge.layoutState = 'failed'
            traceStage(
              'workspace-recovery-failed',
              `correlationId=${knowledge.correlationId ?? 'none'}`,
            )
            runDecision('retries-exhausted')
            return
          }
          retryIndex += 1
          knowledge.retryScheduled = true
          traceStage(
            'workspace-recovery-retry',
            `correlationId=${knowledge.correlationId ?? 'none'} delayMs=${delay} attempt=${retryIndex}`,
          )
          runDecision('retry-scheduled')
          retryTimer = window.setTimeout(() => {
            retryTimer = null
            attemptRecovery()
          }, delay)
        })
    }
    attemptRecovery()
    return () => {
      disposed = true
      clearFallbackTimer()
      clearDeferTimer()
      clearRetryTimer()
      activeRecoveryController?.abort()
      activeRecoveryController = null
      recovery?.dispose()
    }
  }, [startupTerminalFallbackAt])
}
