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
}

export function usePublishTerminalSelection({ tabId, isActive, term }: Options): void {
  useEffect(() => {
    if (!term || !isActive) {
      clearTerminalSelection(tabId)
      return
    }
    const publish = () => publishTerminalSelection(tabId, term.getSelection())
    publish()
    const subscription = term.onSelectionChange(publish)
    return () => {
      subscription.dispose()
      clearTerminalSelection(tabId)
    }
  }, [term, isActive, tabId])
}
