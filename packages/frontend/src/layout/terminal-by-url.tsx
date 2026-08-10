import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import SplitPane from '@/components/split-pane'
import { useAppStore } from '@/store/app'

const TerminalContainer = React.lazy(() =>
  import('@/features/terminal/components/terminal-container/container').then(
    module => ({ default: module.TerminalContainer }),
  ),
)

function TerminalContent({ tabId }: { tabId: string }) {
  const tabs = useAppStore(state => state.tabs)
  const tab = tabs.find(item => item.id === tabId)
  return tab ? <TerminalContainer key={tabId} tabId={tabId} /> : null
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
  const tabId = searchParams.get('tab') ?? ''
  const tabs = useAppStore(state => state.tabs)
  const splitGroups = useAppStore(state => state.splitGroups)

  if (!tabId) return null

  const tab = tabs.find(item => item.id === tabId)
  if (!tab) return null

  const splitGroup = tab.splitId
    ? splitGroups.find(group => group.id === tab.splitId)
    : null

  return (
    <React.Suspense fallback={<TerminalLoadingFallback />}>
      {splitGroup && tab.splitChildren && tab.splitChildren.length > 0 ? (
        <SplitPane group={splitGroup}>
          {splitGroup.tabs.map(id => (
            <TerminalContent key={id} tabId={id} />
          ))}
        </SplitPane>
      ) : (
        <TerminalContent tabId={tabId} />
      )}
    </React.Suspense>
  )
}
