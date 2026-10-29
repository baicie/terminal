import * as React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useAppStore } from '@/store/app'
import { terminalSessionManager } from '@/features/terminal/services/terminal-session-manager'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '@/store/workspace'
import { TerminalWorkbench } from './terminal-workbench'

const TerminalContainer = React.lazy(() =>
  import('@/features/terminal/components/terminal-container/container').then(
    module => ({ default: module.TerminalContainer }),
  ),
)

function TerminalContent({
  tabId,
  workspaceId,
}: {
  tabId: string
  workspaceId: string
}) {
  return <TerminalContainer tabId={tabId} workspaceId={workspaceId} />
}

function TerminalLoadingFallback() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
    </div>
  )
}

export function TerminalByUrl() {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const urlTabId = searchParams.get('tab') ?? ''
  const tabs = useAppStore(state => state.tabs)
  const activeTabId = useAppStore(state => state.activeTabId)
  const splitGroups = useAppStore(state => state.splitGroups)
  const setActiveTab = useAppStore(state => state.setActiveTab)
  const resizeSplit = useAppStore(state => state.resizeSplit)
  const workspaceId =
    useWorkspaceStore(state => state.activeWorkspaceId) ?? 'unscoped'
  const handledUrlTabIdRef = useRef<string | null>(null)

  const urlTab = tabs.find(item => item.id === urlTabId)
  const activeTab = tabs.find(item => item.id === activeTabId)
  const tab = urlTab ?? activeTab ?? tabs[0]

  useEffect(() => {
    if (location.pathname !== '/terminal') {
      handledUrlTabIdRef.current = null
      return
    }
    if (!activeTabId) return

    if (handledUrlTabIdRef.current !== urlTabId) {
      handledUrlTabIdRef.current = urlTabId
      if (urlTab && urlTab.id !== activeTabId) {
        setActiveTab(urlTab.id)
        return
      }
    }

    if (urlTabId === activeTabId) return
    const next = new URLSearchParams(searchParams)
    next.set('tab', activeTabId)
    handledUrlTabIdRef.current = activeTabId
    setSearchParams(next, { replace: true })
  }, [
    activeTabId,
    location.pathname,
    searchParams,
    setSearchParams,
    setActiveTab,
    urlTab,
    urlTabId,
  ])

  useEffect(() => {
    terminalSessionManager.prune(new Set(tabs.map(item => item.id)))
  }, [tabs])

  const handleActivateTab = useCallback(
    (nextTabId: string) => {
      if (nextTabId !== activeTabId) setActiveTab(nextTabId)
    },
    [activeTabId, setActiveTab],
  )

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
        activeTabId={activeTabId}
        isTerminalRoute={isTerminalRoute}
        onActivateTab={handleActivateTab}
        onResizeSplit={resizeSplit}
        renderTerminal={tabId => (
          <TerminalContent
            key={`${workspaceId}:${tabId}`}
            tabId={tabId}
            workspaceId={workspaceId}
          />
        )}
      />
    </React.Suspense>
  )
}
