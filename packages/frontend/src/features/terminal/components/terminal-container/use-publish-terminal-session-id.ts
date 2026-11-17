/**
 * Publish the backend session id so panels beside the terminal can read it.
 *
 * `RightPanel` is a sibling of the terminal layer, not a descendant: the Inspector it
 * renders has no prop path to the session id `useTerminal` holds. Before this, it used
 * `activeTab.id` — a tab id the backend has never seen — and `session_exec` failed
 * against it with a message that named no cause.
 *
 * Two things make this hook worth its own file rather than an inline effect:
 *
 * - it must publish the `null` case too, or a tab whose session ended keeps pointing a
 *   panel at a session that no longer exists;
 * - it must clear on unmount, or a closed tab leaves its id behind for the next tab
 *   that reuses the slot.
 */

import { useEffect } from 'react'
import { publishTerminalSessionId } from '@/features/terminal/services/terminal-session-ids'

export function usePublishTerminalSessionId(tabId: string, sessionId: string | null): void {
  useEffect(() => {
    publishTerminalSessionId(tabId, sessionId)
  }, [tabId, sessionId])

  // A closed tab must not leave its backend id behind: the map outlives the component,
  // and a later tab with the same id would inherit a session that is gone.
  useEffect(() => {
    return () => {
      publishTerminalSessionId(tabId, null)
    }
  }, [tabId])
}
