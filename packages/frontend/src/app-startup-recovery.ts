import { useEffect } from 'react'
import { useAppStore } from './store/app'
import {
  startWorkspaceRecovery,
  type WorkspaceRecoveryHandle,
} from './service/workspace-recovery'
import { bootstrapNow } from './terminal-bootstrap-deadline'

export const STARTUP_TERMINAL_FALLBACK_MS = 2_000
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
    const fallbackAt =
      startupTerminalFallbackAt ?? bootstrapNow() + STARTUP_TERMINAL_FALLBACK_MS
    const openFallback = () => {
      if (disposed || fallbackOpened) return
      if (hasUsableTerminal(useAppStore.getState().tabs)) return
      fallbackOpened = true
      useAppStore
        .getState()
        .addTab({ label: 'Local', type: 'local', startupFallback: true })
    }
    fallbackTimer = window.setTimeout(
      () => {
        if (disposed) return
        fallbackTimer = null
        fallbackDeadlineElapsed = true
        openFallback()
      },
      Math.max(0, fallbackAt - bootstrapNow()),
    )

    const clearRetryTimer = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer)
        retryTimer = null
      }
    }
    const attemptRecovery = () => {
      if (disposed) return
      const controller = new AbortController()
      activeRecoveryController = controller
      void startWorkspaceRecovery({ signal: controller.signal })
        .then(handle => {
          if (disposed) {
            controller.abort()
            handle.dispose()
            return
          }
          if (activeRecoveryController === controller) {
            activeRecoveryController = null
          }
          recovery = handle
          clearRetryTimer()
          const hasUsableTerminalAfterRecovery = hasUsableTerminal(
            useAppStore.getState().tabs,
          )
          if (hasUsableTerminalAfterRecovery) {
            if (fallbackTimer !== null) {
              window.clearTimeout(fallbackTimer)
              fallbackTimer = null
            }
          } else if (fallbackDeadlineElapsed) {
            openFallback()
          }
        })
        .catch(() => {
          if (activeRecoveryController === controller) {
            activeRecoveryController = null
          }
          controller.abort()
          if (disposed) return
          const delay = WORKSPACE_RECOVERY_RETRY_DELAYS_MS[retryIndex]
          if (delay === undefined) return
          retryIndex += 1
          retryTimer = window.setTimeout(() => {
            retryTimer = null
            attemptRecovery()
          }, delay)
        })
    }
    attemptRecovery()
    return () => {
      disposed = true
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer)
        fallbackTimer = null
      }
      clearRetryTimer()
      activeRecoveryController?.abort()
      activeRecoveryController = null
      recovery?.dispose()
    }
  }, [startupTerminalFallbackAt])
}
