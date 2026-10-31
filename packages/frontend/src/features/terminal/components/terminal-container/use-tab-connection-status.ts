import { useEffect } from 'react'
import type { TerminalSessionStatus } from '@/features/terminal/services/terminal-session-manager-types'
import { useAppStore } from '@/store/app'

/** Projects session manager state into the owning tab metadata. */
export function useTabConnectionStatus(
  tabId: string,
  status: TerminalSessionStatus,
): void {
  const tab = useAppStore(state => state.tabs.find(item => item.id === tabId))
  const updateTab = useAppStore(state => state.updateTab)

  useEffect(() => {
    if (!tab) return
    // Every manager state but `idle` has a tab equivalent, so a reconnect and
    // a failure stay distinguishable in the strip instead of collapsing into
    // connecting/disconnected.
    const connectionStatus = status === 'idle' ? undefined : status
    if (tab.connectionStatus === connectionStatus) return
    updateTab(tabId, { connectionStatus })
  }, [status, tab, tabId, updateTab])
}
