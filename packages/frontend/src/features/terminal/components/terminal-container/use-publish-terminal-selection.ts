/**
 * Publish the active terminal's selection for capability-gated readers.
 *
 * Same shape as `usePublishTerminalSize`, which solves the adjacent problem: a piece
 * of terminal state that something outside the container needs, published from the
 * one place that owns the instance.
 *
 * Only the active, visible terminal publishes. A background tab's selection is text
 * the user highlighted on a host they have since left, and handing that to an
 * extension is the failure `terminal.read-selected` exists to prevent. The value is
 * `term.getSelection()` — the same call the context menu's Copy uses — so an extension
 * sees exactly what the user could have copied.
 */

import { useEffect } from 'react'
import type { Terminal as TerminalComponent } from '@baicie/xterm'
import {
  clearTerminalSelection,
  publishTerminalSelection,
} from '@/features/terminal/services/terminal-selection'

interface Options {
  tabId: string
  isActive: boolean
  term: TerminalComponent | null
  /**
   * The backend session the terminal is attached to.
   *
   * Published alongside the tab id so an approval can be tied to the *session*: a
   * reconnect keeps the tab and replaces this value, and an approval captured before
   * the drop must not survive it.
   */
  backendSessionId?: string | null
}

export function usePublishTerminalSelection({
  tabId,
  isActive,
  term,
  backendSessionId = null,
}: Options): void {
  useEffect(() => {
    if (!term || !isActive) {
      clearTerminalSelection(tabId)
      return
    }
    // Both ids travel: the tab identifies where, the backend session identifies what.
    // Only the second changes on a reconnect, which is why an approval has to be
    // checked against it — a tab comparison calls a reconnect "the same session".
    const publish = () =>
      publishTerminalSelection(tabId, term.getSelection(), backendSessionId)
    publish()
    const subscription = term.onSelectionChange(publish)
    return () => {
      subscription.dispose()
      clearTerminalSelection(tabId)
    }
  }, [term, isActive, tabId, backendSessionId])
}
