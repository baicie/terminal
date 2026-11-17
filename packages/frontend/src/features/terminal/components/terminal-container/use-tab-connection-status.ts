import { useEffect } from 'react'
import type { TerminalSessionStatus } from '@/features/terminal/services/terminal-session-manager-types'
import { useAppStore } from '@/store/app'
import { settleOnConnectionStatus } from '@/view/hosts/use-save-after-auth'
import { useSavePromptStore } from '@/view/hosts/save-prompt-store'
import { usePublishTerminalSessionId } from './use-publish-terminal-session-id'

/**
 * Projects session manager state into the owning tab metadata.
 *
 * It also settles the "save this credential?" question, because this is the one place
 * that already knows when a tab's session became `connected` — the only moment a typed
 * credential is known to work. A second handler watching the same status would be a
 * second notion of connected, and the two would eventually disagree.
 */
export function useTabConnectionStatus(
  tabId: string,
  status: TerminalSessionStatus,
  sessionId: string | null = null,
): void {
  const tab = useAppStore(state => state.tabs.find(item => item.id === tabId))
  const updateTab = useAppStore(state => state.updateTab)
  const offerSave = useSavePromptStore(state => state.offer)
  // The backend session id for the panels beside the terminal. Published here because
  // this hook already runs on every status change, and the id changes with the status:
  // a session id that moved without a status transition, or the reverse, is not a
  // state the manager produces. `container.tsx` is at its size limit, so a second call
  // site there was not an option — and two effects watching the same pair would be a
  // second notion of "the session changed".
  usePublishTerminalSessionId(tabId, sessionId)

  useEffect(() => {
    if (!tab) return
    // Every manager state but `idle` has a tab equivalent, so a reconnect and
    // a failure stay distinguishable in the strip instead of collapsing into
    // connecting/disconnected.
    const connectionStatus = status === 'idle' ? undefined : status
    if (tab.connectionStatus === connectionStatus) return
    updateTab(tabId, { connectionStatus })
  }, [status, tab, tabId, updateTab])

  // Settled on the *transition* into `connected`, not on every render while connected:
  // `takeSaveAfterAuth` consumes the entry, so a re-render cannot re-ask, but guarding
  // here keeps the call out of the common path entirely.
  useEffect(() => {
    if (status !== 'connected') return
    const entry = settleOnConnectionStatus(tabId, true)
    if (entry) offerSave(entry)
  }, [status, tabId, offerSave])
}
