import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ActivityRail } from '@/components/activity-rail'
import { SwipeBackIndicator } from '@/components/swipe-back-indicator'
import TopToolbar from '@/components/top-toolbar'
import { StatusBar } from '@/components/status-bar'
import { useTerminalStatusStore } from '@/store/terminal-status'
import { useTransferQueue } from '@/store/transfer-queue'
import { useIsMobile } from '@/hooks/use-breakpoint'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app'
import { RouteTransition } from './route-transition'
import { useSidebarResize } from './use-sidebar-resize'
import { useSwipeBack } from './use-swipe-back'
import { LeftPanel } from './left-panel'
import { RightPanel } from './right-panel'
import { leftPresentationFor } from './layout-decision'
import { usePanelLayout } from './use-panel-layout'
import { useConnectToHost } from '@/features/connection-explorer/use-connect-to-host'
import type { Host } from '@/types'
import { HostDialog } from '@/components/host-list/host-dialog'
import { isTerminalPath } from '@/router/terminal-route'

const BottomNav = lazy(() => import('@/components/bottom-nav'))
const TerminalByUrl = lazy(() =>
  import('./terminal-by-url').then(module => ({
    default: module.TerminalByUrl,
  })),
)

interface MainLayoutContentProps {
  /** Superseded by `AppStore.leftPanel`; kept for one release. */
  sidebarOpen?: boolean
  sidebarWidth: number
  onToggleSidebar: () => void
  onSidebarWidthChange: (width: number) => void
}

export function MainLayoutContent({
  sidebarWidth,
  onToggleSidebar,
  onSidebarWidthChange,
}: MainLayoutContentProps) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const isTerminalRoute = isTerminalPath(useLocation().pathname)
  const hasTerminalTabs = useAppStore(state => state.tabs.length > 0)
  const terminalLayerMountedRef = useRef(false)
  const shouldMountTerminal =
    hasTerminalTabs || terminalLayerMountedRef.current
  const { resizing, onResizeStart, onResizeKeyDown, onToggleCollapse }
    = useSidebarResize(
    sidebarWidth,
    onSidebarWidthChange,
  )
  const { swipeProgress, onSwipeStart, onSwipeMove, onSwipeEnd } =
    useSwipeBack()
  const leftPanel = useAppStore(state => state.leftPanel)
  const setLeftPanel = useAppStore(state => state.setLeftPanel)
  const dismissLeftPanel = useCallback(() => setLeftPanel('none'), [setLeftPanel])
  // The sidebar's real width, which is what `LeftPanel` renders at. Passing it is
  // the whole point: the previous call omitted it and the budget believed the left
  // column was the 52px rail.
  const panelLayout = usePanelLayout({ explorerWidth: sidebarWidth })
  const activeTabHostId = useAppStore(
    state => state.tabs.find(tab => tab.id === state.activeTabId)?.hostId ?? null,
  )
  const { connectToHost } = useConnectToHost()
  const [editingHost, setEditingHost] = useState<Host | null>(null)
  const [creatingHost, setCreatingHost] = useState(false)
  const handleEditHost = useCallback((host: Host) => setEditingHost(host), [])
  const handleNewHost = useCallback(() => setCreatingHost(true), [])
  const closeHostDialog = useCallback(() => {
    setEditingHost(null)
    setCreatingHost(false)
  }, [])

  // Mobile has its own navigation. A panel cannot be open there, so the mode is
  // forced to `none` rather than left at whatever the desktop last had.
  const panelMode = isMobile ? 'none' : leftPanel
  // Only what a real source reported: the active pane's size, and the transfer
  // queue's live count. Nothing here is inferred from "a tab exists".
  const activePaneSize = useTerminalStatusStore(state => state.active)
  const activeTransfers = useTransferQueue(
    state =>
      state.transfers.filter(
        transfer =>
          transfer.status === 'running' || transfer.status === 'queued',
      ).length,
  )

  useEffect(() => {
    if (hasTerminalTabs) terminalLayerMountedRef.current = true
  }, [hasTerminalTabs])

  return (
    <div
      className="h-screen flex flex-col bg-background"
      onTouchStart={onSwipeStart}
      onTouchMove={onSwipeMove}
      onTouchEnd={onSwipeEnd}
    >
      <TopToolbar onToggleSidebar={onToggleSidebar} />

      <div
        ref={panelLayout.shellRef}
        className="flex-1 flex overflow-hidden min-h-0 relative"
        data-terminal-shell=""
      >
        {swipeProgress > 0 && (
          <SwipeBackIndicator
            progress={swipeProgress}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-50 text-muted-foreground"
          />
        )}

        {!isMobile ? <ActivityRail /> : null}

        {/* Sibling of the terminal: opening or closing this never touches
            `TerminalByUrl`, so no PTY is created or disposed. The presentation is
            honoured for both modes — previously only `explorer` read it, and only
            to hide itself, so a `drawer` decision rendered nothing. */}
        {!isMobile ? (
          <LeftPanel
            mode={panelMode}
            presentation={leftPresentationFor(panelLayout, panelMode)}
            width={sidebarWidth}
            resizing={resizing}
            resizeLabel={t('toolbar.resizeSidebar')}
            drawerLabel={t('explorer.title')}
            onToggleCollapse={onToggleCollapse}
            onDismissDrawer={dismissLeftPanel}
            onResizeStart={onResizeStart}
            onResizeKeyDown={onResizeKeyDown}
            onConnect={connectToHost}
            onEdit={handleEditHost}
            onNewHost={handleNewHost}
            activeHostId={activeTabHostId}
          />
        ) : null}

        <main
          className={cn(
            'relative flex-1 min-w-0 overflow-hidden bg-background',
            isMobile && 'mobile-safe-bottom',
          )}
        >
          <div className="relative flex h-full min-h-0">
            <div className="relative min-w-0 flex-1" data-terminal-canvas>
              {shouldMountTerminal ? (
                <Suspense fallback={null}>
                  <TerminalByUrl />
                </Suspense>
              ) : null}
              <RouteTransition
                className={cn(
                  isTerminalRoute
                    ? 'invisible pointer-events-none'
                    : 'relative z-10',
                )}
              >
                <Outlet />
              </RouteTransition>
            </div>
            {/* The dock is a sibling of the terminal layer, never an ancestor:
                opening it must not touch a PTY. It exists only on the canvas
                route, because it is a tool for the session in front of you. */}
            {isTerminalRoute && !isMobile && panelLayout.dockMode !== 'hidden' ? (
              <RightPanel mode={panelLayout.dockMode} />
            ) : null}
          </div>
        </main>
      </div>

      <HostDialog
        open={creatingHost || editingHost !== null}
        host={editingHost ?? undefined}
        onClose={closeHostDialog}
      />

      {isMobile ? (
        <Suspense fallback={<div className="bottom-nav" aria-hidden="true" />}>
          <BottomNav />
        </Suspense>
      ) : (
        <StatusBar
          cols={activePaneSize?.cols}
          rows={activePaneSize?.rows}
          status={activePaneSize?.status}
          sessionLabel={
            activePaneSize === null ? undefined : t(`statusBar.session.${activePaneSize.sessionType}`)
          }
          transfers={activeTransfers}
        />
      )}
    </div>
  )
}
