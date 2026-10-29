import { useLayoutEffect, type RefObject } from 'react'
import { terminalSessionManager } from '@/features/terminal/services/terminal-session-manager'
import type { Terminal } from '@baicie/xterm'

interface TerminalSmokeRoundLifecycleOptions {
  containerRef: RefObject<HTMLDivElement | null>
  controller: AbortController
  runControllerRef: { current: AbortController | null }
  tabId: string
  term: Terminal
}

function abortCurrentRun(
  runControllerRef: { current: AbortController | null },
  reason: Error,
): void {
  runControllerRef.current?.abort(reason)
}

export function useTerminalSmokeRoundLifecycle({
  containerRef,
  controller,
  runControllerRef,
  tabId,
  term,
}: TerminalSmokeRoundLifecycleOptions): void {
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    term.open(container)
    term.focus()
    return () => {
      const reason = new Error('Terminal smoke round unmounted')
      controller.abort(reason)
      abortCurrentRun(runControllerRef, reason)
      void terminalSessionManager
        .close(tabId)
        .catch(closeError => {
          console.error('Failed to close terminal smoke session:', closeError)
        })
        .then(() => term.dispose())
    }
  }, [containerRef, controller, runControllerRef, tabId, term])
}
