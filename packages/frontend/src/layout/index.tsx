import type { TitleBarStyle } from '@/components/custom-title-bar'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ShortcutsHelpDialog from '@/components/shortcuts-help'
import { useIsMobile } from '@/hooks/use-breakpoint'
import { useGlobalShortcuts } from '@/hooks/use-global-shortcuts'
import { useTrayEvents } from '@/hooks/use-tray-events'
import { useAppStore } from '@/store/app'
import { MainLayoutContent } from './main-layout-content'
import { readSidebarWidth } from './sidebar-width'
import { useLayoutShortcutEvents } from './use-layout-shortcut-events'

const SettingsDialog = React.lazy(() => import('@/components/settings-dialog'))

function detectTitleBarStyle(): TitleBarStyle {
  if (typeof navigator === 'undefined') return 'linux'

  const platform = navigator.platform.toLowerCase()
  if (platform.includes('mac') || platform.includes('darwin')) return 'macos'
  if (platform.includes('win') || platform.includes('windows')) return 'windows'
  return 'linux'
}

const MainLayout: React.FC = () => {
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false)
  const [, setTitleBarStyle] = useState<TitleBarStyle>('linux')
  const addTab = useAppStore(state => state.addTab)
  const sidebarVisible = useAppStore(state => state.sidebarVisible)
  const toggleSidebar = useAppStore(state => state.toggleSidebar)
  const navigate = useNavigate()
  const location = useLocation()
  const activeTabId = useAppStore(state => state.activeTabId)
  const tabCount = useAppStore(state => state.tabs.length)
  const initialPathRef = React.useRef(location.pathname)
  const autoOpenedRef = React.useRef(false)
  const isMobile = useIsMobile()

  useEffect(() => {
    if (
      autoOpenedRef.current ||
      !activeTabId ||
      tabCount === 0 ||
      !['/', '/hosts'].includes(initialPathRef.current) ||
      location.pathname !== initialPathRef.current
    ) {
      return
    }
    autoOpenedRef.current = true
    navigate(`/terminal?tab=${encodeURIComponent(activeTabId)}`, {
      replace: true,
    })
  }, [activeTabId, location.pathname, navigate, tabCount])

  useEffect(() => {
    setTitleBarStyle(detectTitleBarStyle())
  }, [])

  const handleNewLocalTerminal = useCallback(() => {
    const newTab = addTab({ label: 'Local', type: 'local' })
    navigate(`/terminal?tab=${newTab.id}`)
  }, [addTab, navigate])

  const handleToggleSidebar = useCallback(() => {
    toggleSidebar()
  }, [toggleSidebar])
  const handleToggleHelp = useCallback(() => {
    setShortcutsHelpOpen(previous => !previous)
  }, [])
  const handleOpenHelp = useCallback(() => {
    setShortcutsHelpOpen(true)
  }, [])

  useGlobalShortcuts()
  useTrayEvents()
  useLayoutShortcutEvents({
    onNewLocalTerminal: handleNewLocalTerminal,
    onToggleSidebar: handleToggleSidebar,
    onToggleHelp: handleToggleHelp,
    onOpenHelp: handleOpenHelp,
  })

  return (
    <>
      <MainLayoutContent
        sidebarOpen={!isMobile && sidebarVisible}
        sidebarWidth={sidebarWidth}
        onToggleSidebar={handleToggleSidebar}
        onSidebarWidthChange={setSidebarWidth}
      />

      {settingsDialogOpen && (
        <React.Suspense fallback={null}>
          <SettingsDialog
            open={settingsDialogOpen}
            onClose={() => setSettingsDialogOpen(false)}
          />
        </React.Suspense>
      )}

      <ShortcutsHelpDialog
        open={shortcutsHelpOpen}
        onOpenChange={setShortcutsHelpOpen}
      />
    </>
  )
}

export default MainLayout
