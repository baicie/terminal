import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Outlet, useNavigate, useSearchParams } from 'react-router-dom'
import { useInjectable } from '@/hooks/use-di'
import { AppStore } from '@/store/app'
import SplitPane from '@/components/split-pane'
import TerminalContainer from '@/view/terminal/terminal-container'
import AppSidebar from '@/components/app-sidebar'
import TopToolbar from '@/components/top-toolbar'
import { CustomTitleBar } from '@/components/custom-title-bar'
import { cn } from '@/lib/utils'
import type { TitleBarStyle } from '@/components/custom-title-bar'
import SettingsDialog from '@/components/settings-dialog'
import { observer } from 'mobx-react-lite'

const SIDEBAR_WIDTH_KEY = 'terminal.sidebar.width'
const SIDEBAR_MIN = 64 // 图标模式宽度
const SIDEBAR_MAX = 420
const SIDEBAR_DEFAULT = 200

function readSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (!raw) return SIDEBAR_DEFAULT
    const n = parseInt(raw, 10)
    if (Number.isNaN(n)) return SIDEBAR_DEFAULT
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n))
  } catch {
    return SIDEBAR_DEFAULT
  }
}

// 读取 URL query 参数中的 tabId
const useTerminalTabId = (): string | null => {
  const [searchParams] = useSearchParams()
  return searchParams.get('tab')
}

const TerminalContent: React.FC<{ tabId: string }> = ({ tabId }) => {
  const app = useInjectable(AppStore)
  const tab = app.tabs.find(t => t.id === tabId)

  if (!tab) return null

  return <TerminalContainer key={tabId} tabId={tabId} />
}

// 根据 URL tab 参数渲染终端内容
const TerminalByUrl: React.FC = observer(() => {
  const app = useInjectable(AppStore)
  const tabId = useTerminalTabId()

  if (!tabId) return null

  const tab = app.tabs.find(t => t.id === tabId)
  if (!tab) return null

  const splitGroup = tab.splitId
    ? app.splitGroups.find(g => g.id === tab.splitId)
    : null

  if (splitGroup && tab.splitChildren && tab.splitChildren.length > 0) {
    const children = splitGroup.tabs.map(id => (
      <TerminalContent key={id} tabId={id} />
    ))
    return <SplitPane group={splitGroup}>{children}</SplitPane>
  }

  return <TerminalContent tabId={tabId} />
})

const MainLayoutInner: React.FC<{
  sidebarOpen: boolean
  onToggleSidebar: () => void
  sidebarWidth: number
  onSidebarWidthChange: (w: number) => void
}> = observer(({ sidebarOpen, onToggleSidebar, sidebarWidth, onSidebarWidthChange }) => {
  const [resizing, setResizing] = useState(false)
  const dragRef = useRef({ startX: 0, startWidth: SIDEBAR_DEFAULT })
  const lastWidthRef = useRef(sidebarWidth)
  lastWidthRef.current = sidebarWidth

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startWidth: sidebarWidth }
      setResizing(true)
    },
    [sidebarWidth],
  )

  // 折叠按钮：切换最小宽度和默认宽度
  const handleToggleCollapse = useCallback(() => {
    const next = sidebarWidth <= SIDEBAR_MIN ? SIDEBAR_DEFAULT : SIDEBAR_MIN
    onSidebarWidthChange(next)
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next))
    } catch {
      /* ignore */
    }
  }, [sidebarWidth, onSidebarWidthChange])

  useEffect(() => {
    if (!resizing) return

    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragRef.current.startX
      let next = dragRef.current.startWidth + dx

      next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, next))
      lastWidthRef.current = next
      onSidebarWidthChange(next)
    }

    const onUp = () => {
      setResizing(false)
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(lastWidthRef.current))
      } catch {
        /* ignore */
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [resizing, onSidebarWidthChange])

  return (
    <div className="h-screen flex flex-col bg-background">
      <TopToolbar onToggleSidebar={onToggleSidebar} />

      <div className="flex-1 flex overflow-hidden min-h-0">
        {sidebarOpen && (
          <>
            <AppSidebar
              onToggleCollapse={handleToggleCollapse}
              width={sidebarWidth}
              resizing={resizing}
            />
            <div
              role="separator"
              aria-orientation="vertical"
              aria-valuenow={sidebarWidth}
              tabIndex={0}
              className={cn(
                'w-[6px] shrink-0 cursor-col-resize flex items-center justify-center group outline-none select-none',
                'hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                resizing && 'cursor-col-resize bg-primary/20',
              )}
              onMouseDown={onResizeStart}
            >
              {/* 拖拽手柄点 */}
              <div className="flex flex-col gap-1.5 py-8 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="w-1 h-1 rounded-full bg-muted-foreground/60" />
                <span className="w-1 h-1 rounded-full bg-muted-foreground/60" />
                <span className="w-1 h-1 rounded-full bg-muted-foreground/60" />
              </div>
            </div>
          </>
        )}

        <main className="flex-1 min-w-0 overflow-hidden bg-background">
          <TerminalByUrl />
          <Outlet />
        </main>
      </div>
    </div>
  )
})

const MainLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth)
  const [titleBarStyle, setTitleBarStyle] = useState<TitleBarStyle | null>(null)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const app = useInjectable(AppStore)
  const navigate = useNavigate()

  // Detect platform for title bar style
  useEffect(() => {
    const detect = (): TitleBarStyle => {
      if (typeof navigator !== 'undefined') {
        const platform = navigator.platform.toLowerCase()
        if (platform.includes('mac') || platform.includes('darwin')) {
          return 'macos'
        }
        if (platform.includes('win') || platform.includes('windows')) {
          return 'windows'
        }
      }
      return 'linux'
    }
    setTitleBarStyle(detect())
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault()
        handleNewLocalTerminal()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault()
        setSidebarOpen(prev => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleNewLocalTerminal = () => {
    const newTab = app.addTab({
      label: 'Local',
      type: 'local',
    })
    console.log('[handleNewLocalTerminal] newTab:', newTab, '| app.tabs:', app.tabs.map(t => t.id))
    navigate(`/terminal?tab=${newTab.id}`)
  }

  return (
    <>
      {/* {titleBarStyle && (
        <CustomTitleBar
          style={titleBarStyle}
          onSettingsClick={() => setSettingsDialogOpen(true)}
        />
      )} */}
      <MainLayoutInner
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(p => !p)}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={setSidebarWidth}
      />

      <SettingsDialog
        open={settingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
      />
    </>
  )
}

export default MainLayout
