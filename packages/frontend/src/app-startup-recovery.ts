import { useEffect } from 'react'
import { useAppStore } from './store/app'
import { useHostStore } from './store/host'
import {
  startWorkspaceRecovery,
  type WorkspaceRecoveryHandle,
} from './service/workspace-recovery'
import { bootstrapNow } from './terminal-bootstrap-deadline'

export const STARTUP_TERMINAL_FALLBACK_MS = 2_000
export const WORKSPACE_RECOVERY_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const

function hasUsableTerminal(
  tabs: ReadonlyArray<{ type: string; hostId?: string }>,
  hosts: ReadonlyArray<{ id: string }>,
): boolean {
  const hostIds = new Set(hosts.map(host => host.id))
  return tabs.some(
    tab =>
      tab.type === 'local' ||
      (tab.type === 'remote' && hostIds.has(tab.hostId ?? '')),
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
    const fallbackAt =
      startupTerminalFallbackAt ?? bootstrapNow() + STARTUP_TERMINAL_FALLBACK_MS
    const fallbackTimer = window.setTimeout(
      () => {
        if (disposed) return
        fallbackDeadlineElapsed = true
        const { tabs, addTab } = useAppStore.getState()
        if (!hasUsableTerminal(tabs, useHostStore.getState().hosts)) {
          addTab({ label: 'Local', type: 'local', startupFallback: true })
        }
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
          const { tabs, addTab } = useAppStore.getState()
          const hasUsableTerminalAfterRecovery = hasUsableTerminal(
            tabs,
            useHostStore.getState().hosts,
          )
          if (hasUsableTerminalAfterRecovery) {
            window.clearTimeout(fallbackTimer)
          } else if (fallbackDeadlineElapsed) {
            addTab({ label: 'Local', type: 'local', startupFallback: true })
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
      window.clearTimeout(fallbackTimer)
      clearRetryTimer()
      activeRecoveryController?.abort()
      activeRecoveryController = null
      recovery?.dispose()
    }
  }, [startupTerminalFallbackAt])
}
