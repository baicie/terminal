import * as React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useAppStore } from '@/store/app'
import { terminalSessionManager } from '@/features/terminal/services/terminal-session-manager'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '@/store/workspace'
import { TerminalWorkbench } from './terminal-workbench'
import { isTerminalPath } from '@/router/terminal-route'

/**
 * The save prompt for a one-time credential.
 *
 * Mounted here rather than in the Hosts view because the question is raised by the
 * connection that proved the credential, and connecting navigates to the terminal — so
 * by the time the answer is needed the Hosts route may no longer exist. This component
 * only renders while the terminal layer does, which is exactly the lifetime the question
 * has.
 *
 * Lazy so a build without any one-time connection never loads it.
 */
const SaveCredentialPrompt = React.lazy(() =>
  import('@/view/hosts/save-credential-prompt').then(module => ({
    default: module.SaveCredentialPrompt,
  })),
)

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
    if (!isTerminalPath(location.pathname)) {
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
  const isTerminalRoute = isTerminalPath(location.pathname)

  return (
    <React.Suspense fallback={<TerminalLoadingFallback />}>
      <SaveCredentialPrompt />
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
