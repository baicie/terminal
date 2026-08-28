import { useCallback } from 'react'
import { normalizeTerminalTitle } from '@/features/terminal/services/terminal-title'
import { useAppStore } from '@/store/app'

export function useTabTitle(tabId: string): (title: string) => void {
  const updateTab = useAppStore(state => state.updateTab)
  return useCallback(
    (title: string) => {
      const nextTitle = normalizeTerminalTitle(title)
      const currentTab = useAppStore
        .getState()
        .tabs.find(item => item.id === tabId)
      if (!currentTab || currentTab.title === nextTitle) return
      updateTab(tabId, { title: nextTitle })
    },
    [tabId, updateTab],
  )
}
