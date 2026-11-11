import { useEffect } from 'react'
import {
  useTerminalStatusStore,
  type TerminalStatusSnapshot,
} from '@/store/terminal-status'

/**
 * Report this pane's size to the status bar, but only while it is the active tab.
 *
 * Extracted from `TerminalContainer` because that file is at its size limit and
 * because "what the status bar should show" is a different decision from "how the
 * pane renders".
 *
 * The size comes from the xterm instance, which is the size the PTY was told —
 * measuring the container instead would report what CSS did rather than what the
 * shell received.
 */
export function usePublishTerminalSize(options: {
  tabId: string
  isActive: boolean
  isReady: boolean
  term: { cols: number, rows: number } | null
  /** Re-runs the publish when the session state changes, e.g. after a reconnect. */
  status: TerminalStatusSnapshot['status']
}): void {
  const publish = useTerminalStatusStore(state => state.publish)
  const clear = useTerminalStatusStore(state => state.clear)
  const { tabId, isActive, isReady, term, status } = options

  useEffect(() => {
    if (!isActive) {
      clear(tabId)
      return
    }
    if (!isReady || !term) return
    const report = () => {
      if (term.cols > 0 && term.rows > 0) {
        publish({ tabId, cols: term.cols, rows: term.rows, status })
      }
    }
    report()
    window.addEventListener('resize', report)
    return () => window.removeEventListener('resize', report)
  }, [tabId, isActive, isReady, term, status, publish, clear])
}
