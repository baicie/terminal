import * as React from 'react'
import { useEffect } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useAppStore } from '@/store/app'
import { terminalSessionManager } from '@/features/terminal/services/terminal-session-manager'
import { TerminalWorkbench } from './terminal-workbench'

const TerminalContainer = React.lazy(() =>
  import('@/features/terminal/components/terminal-container/container').then(
    module => ({ default: module.TerminalContainer }),
  ),
)

function TerminalContent({ tabId }: { tabId: string }) {
  return <TerminalContainer key={tabId} tabId={tabId} />
}

function TerminalLoadingFallback() {
  return (
    <div className="h-full flex items-center justify-center bg-[#1e1e1e]">
      <div className="text-[#888] text-sm">Loading terminal…</div>
    </div>
  )
}

export function TerminalByUrl() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const tabId = searchParams.get('tab') ?? ''
  const tabs = useAppStore(state => state.tabs)
  const activeTabId = useAppStore(state => state.activeTabId)
  const splitGroups = useAppStore(state => state.splitGroups)

  const requestedTabId = tabId || activeTabId || ''
  const tab = tabs.find(item => item.id === requestedTabId) ?? tabs[0]

  useEffect(() => {
    terminalSessionManager.prune(new Set(tabs.map(item => item.id)))
  }, [tabs])

  if (!tab) return null
  const visibleTabId = tab.id

  const splitGroup = tab.splitId
    ? splitGroups.find(group => group.id === tab.splitId)
    : null
  const activeSplitGroup =
    splitGroup && splitGroup.tabs.length >= 2 ? splitGroup : null

  const visibleIds = new Set(
    activeSplitGroup ? activeSplitGroup.tabs.slice(0, 2) : [visibleTabId],
  )
  const isTerminalRoute = location.pathname === '/terminal'

  return (
    <React.Suspense fallback={<TerminalLoadingFallback />}>
      <TerminalWorkbench
        tabs={tabs}
        visibleTabIds={visibleIds}
        splitGroup={activeSplitGroup}
        isTerminalRoute={isTerminalRoute}
        renderTerminal={tabId => <TerminalContent tabId={tabId} />}
      />
    </React.Suspense>
  )
}
