import type { TitleBarStyle } from '@/components/custom-title-bar'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useNavigate, useSearchParams } from 'react-router-dom'
import AppSidebar from '@/components/app-sidebar'
import BottomNav from '@/components/bottom-nav'
import ShortcutsHelpDialog from '@/components/shortcuts-help'
import SplitPane from '@/components/split-pane'
import TopToolbar from '@/components/top-toolbar'

// 设置对话框首屏不需要，懒加载到独立 chunk
const SettingsDialog = React.lazy(() => import('@/components/settings-dialog'))
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app'
import {
  SwipeBackIndicator,
} from '@/components/swipe-back-indicator'
import { useIsMobile } from '@/hooks/use-breakpoint'
import { useGlobalShortcuts } from '@/hooks/use-global-shortcuts'
import { SHORTCUT_EVENT_PREFIX } from '@/hooks/use-global-shortcuts'
import { useTrayEvents } from '@/hooks/use-tray-events'
import { RouteTransition } from './route-transition'

// 终端容器懒加载：xterm.js + 所有 addon 体积合计 ~340 KB，
// 仅在用户真正打开第一个标签时才需要。这样首屏（hosts/keychain 等
// 非终端视图）启动可以省去这部分 JS 解析时间。
const TerminalContainer = React.lazy(() =>
  import('@/features/terminal/components/terminal-container/container').then(
    m => ({ default: m.TerminalContainer }),
  ),
)

const SIDEBAR_WIDTH_KEY = 'terminal.sidebar.width'
const SIDEBAR_MIN = 64 // 图标模式宽度
const SIDEBAR_MAX = 420
const SIDEBAR_DEFAULT = 176

function readSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (!raw) return SIDEBAR_DEFAULT
    const n = Number.parseInt(raw, 10)
    if (Number.isNaN(n)) return SIDEBAR_DEFAULT
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n))
  } catch {
    return SIDEBAR_DEFAULT
  }
}

// 读取 URL query 参数中的 tabId
const TerminalContent: React.FC<{ tabId: string }> = ({ tabId }) => {
  const tabs = useAppStore(s => s.tabs)
  const tab = tabs.find(t => t.id === tabId)
  if (!tab) return null
  return <TerminalContainer key={tabId} tabId={tabId} />
}

const TerminalLoadingFallback: React.FC = () => (
  <div className="h-full flex items-center justify-center bg-[#1e1e1e]">
    <div className="text-[#888] text-sm">Loading terminal…</div>
  </div>
)

const TerminalByUrl: React.FC = () => {
  const [searchParams] = useSearchParams()
  const tabId = searchParams.get('tab') ?? ''

  const tabs = useAppStore(s => s.tabs)
  const splitGroups = useAppStore(s => s.splitGroups)

  if (!tabId) return null

  const tab = tabs.find(t => t.id === tabId)
  if (!tab) return null

  const splitGroup = tab.splitId
    ? splitGroups.find(g => g.id === tab.splitId)
    : null

  // 单一 Suspense 边界：避免每个 split 子终端各自 fallback 闪烁，
  // chunk 一旦下载就所有 TerminalContainer 共享。
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

const MainLayoutInner: React.FC<{
  sidebarOpen: boolean
  onToggleSidebar: () => void
  sidebarWidth: number
  onSidebarWidthChange: (w: number) => void
}> = ({ sidebarOpen, onToggleSidebar, sidebarWidth, onSidebarWidthChange }) => {
  const isMobile = useIsMobile()
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

  const startXRef = useRef<number | null>(null)
  const startYRef = useRef<number | null>(null)
  const swipeProgressRef = useRef(0)
  const [swipeProgress, setSwipeProgress] = useState(0)

  const onSwipeStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0]
    if (touch.clientX <= 24) {
      startXRef.current = touch.clientX
      startYRef.current = touch.clientY
    }
  }, [])

  const onSwipeMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (startXRef.current === null) return
    const touch = e.touches[0]
    const dx = touch.clientX - startXRef.current
    const dy = Math.abs(touch.clientY - (startYRef.current ?? 0))
    if (dy > 50) { startXRef.current = null; setSwipeProgress(0); return }
    if (dx > 0) { e.preventDefault(); setSwipeProgress(Math.min(dx / 80, 1)) }
    else { setSwipeProgress(0) }
  }, [])

  const onSwipeEnd = useCallback(() => {
    if (startXRef.current !== null && swipeProgressRef.current >= 1) {
      window.history.back()
    }
    startXRef.current = null
    startYRef.current = null
    swipeProgressRef.current = 0
    setSwipeProgress(0)
  }, [])

  useEffect(() => { swipeProgressRef.current = swipeProgress }, [swipeProgress])

  return (
    <div
      className="h-screen flex flex-col bg-background"
      onTouchStart={onSwipeStart}
      onTouchMove={onSwipeMove}
      onTouchEnd={onSwipeEnd}
    >
      <TopToolbar onToggleSidebar={onToggleSidebar} />

      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        {/* Swipe-back indicator */}
        {swipeProgress > 0 && (
          <SwipeBackIndicator
            progress={swipeProgress}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-50 text-muted-foreground"
          />
        )}
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

        <main
          className={cn(
            'flex-1 min-w-0 overflow-hidden bg-background',
            // On mobile, add safe bottom padding for the bottom nav
            isMobile && 'mobile-safe-bottom',
          )}
        >
          <TerminalByUrl />
          <RouteTransition>
            <Outlet />
          </RouteTransition>
        </main>
      </div>

      {/* Mobile bottom navigation — hidden on desktop */}
      {isMobile && <BottomNav />}
    </div>
  )
}

const MainLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false)
  const [, setTitleBarStyle] = useState<TitleBarStyle>('linux')
  const addTab = useAppStore(s => s.addTab)
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  // On mobile, always hide sidebar (controlled by BottomNav hamburger instead)
  useEffect(() => {
    if (isMobile) setSidebarOpen(false)
  }, [isMobile])

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

  const handleNewLocalTerminal = useCallback(() => {
    const newTab = addTab({
      label: 'Local',
      type: 'local',
    })
    navigate(`/terminal?tab=${newTab.id}`)
  }, [addTab, navigate])

  // 单一来源：所有 keydown 都通过 shortcutsService 处理
  useGlobalShortcuts()
  // 系统托盘菜单点击 → 派发为相同的 shortcut:* CustomEvent
  useTrayEvents()

  // 订阅各 action：把 service 派发的事件映射到 layout 内部状态/操作
  useEffect(() => {
    const onNewTab = () => handleNewLocalTerminal()
    const onNewLocal = () => handleNewLocalTerminal()
    const onToggleSidebar = () => setSidebarOpen(prev => !prev)

    window.addEventListener(`${SHORTCUT_EVENT_PREFIX}new-tab`, onNewTab)
    window.addEventListener(`${SHORTCUT_EVENT_PREFIX}new-local`, onNewLocal)
    window.addEventListener(
      `${SHORTCUT_EVENT_PREFIX}toggle-sidebar`,
      onToggleSidebar,
    )

    return () => {
      window.removeEventListener(`${SHORTCUT_EVENT_PREFIX}new-tab`, onNewTab)
      window.removeEventListener(
        `${SHORTCUT_EVENT_PREFIX}new-local`,
        onNewLocal,
      )
      window.removeEventListener(
        `${SHORTCUT_EVENT_PREFIX}toggle-sidebar`,
        onToggleSidebar,
      )
    }
  }, [handleNewLocalTerminal])

  // 帮助面板的快捷键不在 shortcutsService 默认表中（也无意义放进去），
  // 单独保留 Cmd/Ctrl+/ 与 Shift+? 两个触发方式
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      )
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const openShortcuts =
        ((e.ctrlKey || e.metaKey) && e.key === '/') ||
        (e.shiftKey && e.key === '?' && !isEditableTarget(e.target))
      if (openShortcuts) {
        e.preventDefault()
        setShortcutsHelpOpen(prev => !prev)
      }
    }
    const handleOpenHelp = () => setShortcutsHelpOpen(true)

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('open-shortcuts-help', handleOpenHelp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('open-shortcuts-help', handleOpenHelp)
    }
  }, [])

  return (
    <>
      <MainLayoutInner
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(p => !p)}
        sidebarWidth={sidebarWidth}
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
