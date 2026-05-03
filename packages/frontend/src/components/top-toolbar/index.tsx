import {
  ArrowLeft,
  BellIcon,
  FolderUp,
  Home,
  PanelLeft,
  Plus,
  Search,
  Settings,
} from 'lucide-react'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

// 三个弹窗都仅在用户主动触发时显示，懒加载到独立 chunk 节省首屏体积
const CommandPalette = React.lazy(() => import('@/components/command-palette'))
const HostDialog = React.lazy(() =>
  import('@/components/host-list/host-dialog').then(m => ({
    default: m.HostDialog,
  })),
)
const NotificationPanel = React.lazy(() =>
  import('@/components/notification-panel').then(m => ({
    default: m.NotificationPanel,
  })),
)
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import MenuTabs from '@/layout/tabs'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app'
import { useNotificationStore } from '@/store/notification'
import { useIsMobile } from '@/hooks/use-breakpoint'

const TopToolbar: React.FC<{
  onToggleSidebar: () => void
}> = ({ onToggleSidebar }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const addTab = useAppStore(s => s.addTab)
  const isMobile = useIsMobile()
  const unreadCount = useNotificationStore(s => s.notifications.filter(n => !n.read).length)

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [hostDialogOpen, setHostDialogOpen] = useState(false)
  const [padForMacTrafficLights, setPadForMacTrafficLights] = useState(false)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false)

  const isSftpActive = location.pathname === '/sftp'

  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI__' in window)) return
    const p = navigator.platform?.toLowerCase() ?? ''
    const ua = navigator.userAgent?.toLowerCase() ?? ''
    const isMac = p.includes('mac') || ua.includes('mac')
    if (isMac) setPadForMacTrafficLights(true)
  }, [])

  // 全局快捷键由 layout 内 useGlobalShortcuts 注册一次，所有组件
  // 通过 `shortcut:<action>` 自定义事件订阅；此处只关心两个 action
  useEffect(() => {
    const onCommandPalette = () => setCommandPaletteOpen(true)
    const onNewSsh = () => setHostDialogOpen(true)
    window.addEventListener('shortcut:command-palette', onCommandPalette)
    window.addEventListener('shortcut:new-ssh', onNewSsh)
    return () => {
      window.removeEventListener('shortcut:command-palette', onCommandPalette)
      window.removeEventListener('shortcut:new-ssh', onNewSsh)
    }
  }, [])

  const handleNewLocalTerminal = () => {
    const newTab = addTab({
      label: 'Local',
      type: 'local',
    })
    navigate(`/terminal?tab=${newTab.id}`)
  }

  const handleNavClick = (path: string) => {
    setMobileDrawerOpen(false)
    navigate(path)
  }

  const navItems = [
    { label: t('nav.hosts'), icon: <Home className="size-5" />, path: '/hosts' },
    { label: t('toolbar.sftp'), icon: <FolderUp className="size-5" />, path: '/sftp' },
  ]

  const getPageTitle = (pathname: string): string => {
    const item = navItems.find(n => n.path === pathname)
    if (item) return item.label
    switch (pathname) {
      case '/keychain': return 'Keychain'
      case '/port-forward': return 'Port Forward'
      case '/snippets': return 'Snippets'
      case '/known-hosts': return 'Known Hosts'
      case '/logs': return 'Logs'
      case '/settings': return 'Settings'
      case '/terminal': return 'Terminal'
      default: return 'Hosts'
    }
  }

  // ─── Mobile layout ───────────────────────────────────────────────
  if (isMobile) {
    return (
      <>
        <header
          className="h-12 flex items-center justify-between border-b border-border/60 bg-background shrink-0 gap-2 px-3"
          data-tauri-drag-region
        >
          {/* Left: Hamburger */}
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setMobileDrawerOpen(true)}
            title="Menu"
            data-tauri-drag-region="false"
          >
            <PanelLeft className="size-5" />
          </Button>

          {/* Center: Current page title */}
          <div className="flex-1 text-center" data-tauri-drag-region="false">
            <span className="text-sm font-medium text-foreground truncate">
              {getPageTitle(location.pathname)}
            </span>
          </div>

          {/* Right: Back button (when on a sub-page) */}
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => navigate(-1)}
            title={t('common.back')}
            data-tauri-drag-region="false"
          >
            <ArrowLeft className="size-5" />
          </Button>
        </header>

        {/* Mobile left drawer */}
        <Sheet open={mobileDrawerOpen} onOpenChange={setMobileDrawerOpen}>
          <SheetContent
            side="left"
            className="w-[280px]"
          >
            <div className="flex flex-col gap-1 pt-2">
              <p className="px-2 pb-3 text-sm font-semibold text-muted-foreground">
                {t('app.name')}
              </p>

              {navItems.map(item => (
                <button
                  key={item.path}
                  className={cn(
                    'flex items-center gap-3 w-full px-3 py-3 rounded-lg',
                    'transition-colors duration-150 active:scale-[0.98]',
                    location.pathname === item.path
                      ? 'bg-secondary/80 text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                  onClick={() => handleNavClick(item.path)}
                >
                  {item.icon}
                  <span className="text-sm">{item.label}</span>
                </button>
              ))}

              <div className="my-3 border-t border-border/60" />

              {/* Settings shortcut */}
              <button
                className="flex items-center gap-3 w-full px-3 py-3 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors duration-150 active:scale-[0.98]"
                onClick={() => handleNavClick('/settings')}
              >
                <Settings className="size-5" />
                <span className="text-sm">{t('nav.settings')}</span>
              </button>
            </div>
          </SheetContent>
        </Sheet>

        {hostDialogOpen && (
          <React.Suspense fallback={null}>
            <HostDialog
              open={hostDialogOpen}
              onClose={() => setHostDialogOpen(false)}
            />
          </React.Suspense>
        )}

        {commandPaletteOpen && (
          <React.Suspense fallback={null}>
            <CommandPalette
              open={commandPaletteOpen}
              onClose={() => setCommandPaletteOpen(false)}
            />
          </React.Suspense>
        )}
      </>
    )
  }

  // ─── Desktop layout ──────────────────────────────────────────────
  const isMac =
    typeof navigator !== 'undefined' && /mac|darwin/i.test(navigator.platform)
  const cmdKeyLabel = isMac ? '⌘K' : 'Ctrl+K'

  return (
    <>
      <header
        className={cn(
          'h-11 flex items-center border-b border-border/60 bg-background shrink-0 gap-2',
          padForMacTrafficLights ? 'pl-[76px] pr-3' : 'px-3',
        )}
        data-tauri-drag-region
      >
        {/* ─ Region 1: 折叠按钮 + 视图入口 ───────────────── */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            onClick={onToggleSidebar}
            title={t('toolbar.toggleSidebar')}
            data-tauri-drag-region="false"
          >
            <PanelLeft className="size-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/sftp')}
            className={cn(
              'gap-1.5 h-8 px-3 rounded-md transition-colors duration-150',
              isSftpActive
                ? 'bg-secondary/80 text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            data-tauri-drag-region="false"
          >
            <FolderUp className="size-4" data-icon="inline-start" />
            {t('toolbar.sftp')}
          </Button>
        </div>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* ─ Region 2: 会话标签（可滚动）+ 新建 ─────────── */}
        <div className="flex items-center gap-0.5 min-w-0 flex-1">
          <MenuTabs />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
            title={t('toolbar.newTab')}
            onClick={handleNewLocalTerminal}
            data-tauri-drag-region="false"
          >
            <Plus className="size-4" />
          </Button>
        </div>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* ─ Region 3: 全局操作 ────────────────────────── */}
        <div className="flex items-center gap-0.5 shrink-0">
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCommandPaletteOpen(true)}
                className="gap-2 h-8 px-2.5 text-muted-foreground hover:text-foreground"
                data-tauri-drag-region="false"
              >
                <Search className="size-4" />
                <kbd className="hidden lg:inline-flex h-5 items-center gap-0.5 rounded border border-border/60 bg-secondary/50 px-1.5 text-[10px] font-mono text-muted-foreground">
                  {cmdKeyLabel}
                </kbd>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('toolbar.commandPalette')}</TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground relative"
                onClick={() => setNotificationPanelOpen(true)}
                data-tauri-drag-region="false"
              >
                <BellIcon className="size-4" />
                {unreadCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 min-w-[16px] h-[16px] rounded-full bg-primary text-[9px] font-semibold text-primary-foreground flex items-center justify-center px-1 leading-none">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('toolbar.notifications')}</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {hostDialogOpen && (
        <React.Suspense fallback={null}>
          <HostDialog
            open={hostDialogOpen}
            onClose={() => setHostDialogOpen(false)}
          />
        </React.Suspense>
      )}

      {commandPaletteOpen && (
        <React.Suspense fallback={null}>
          <CommandPalette
            open={commandPaletteOpen}
            onClose={() => setCommandPaletteOpen(false)}
          />
        </React.Suspense>
      )}

      {notificationPanelOpen && (
        <React.Suspense fallback={null}>
          <NotificationPanel
            open={notificationPanelOpen}
            onOpenChange={setNotificationPanelOpen}
          />
        </React.Suspense>
      )}
    </>
  )
}

export default TopToolbar
