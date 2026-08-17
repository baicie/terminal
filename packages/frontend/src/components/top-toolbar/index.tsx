import { BellIcon, FolderUp, PanelLeft, Plus, Search } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import WorkspaceSwitcher from '@/components/workspace-switcher'
import { useIsMobile } from '@/hooks/use-breakpoint'
import MenuTabs from '@/layout/tabs'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app'
import { useNotificationStore } from '@/store/notification'
import { useTransferQueue } from '@/store/transfer-queue'
import { ToolbarOverlays } from './toolbar-overlays'

const MobileToolbar = lazy(() =>
  import('./mobile-toolbar').then(module => ({
    default: module.MobileToolbar,
  })),
)

const TopToolbar: React.FC<{ onToggleSidebar: () => void }> = ({
  onToggleSidebar,
}) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const addTab = useAppStore(state => state.addTab)
  const isMobile = useIsMobile()
  const unreadCount = useNotificationStore(
    state =>
      state.notifications.filter(notification => !notification.read).length,
  )
  const activeTransferCount = useTransferQueue(
    state =>
      state.transfers.filter(
        transfer =>
          transfer.status === 'running' || transfer.status === 'queued',
      ).length,
  )
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [hostDialogOpen, setHostDialogOpen] = useState(false)
  const [padForMacTrafficLights, setPadForMacTrafficLights] = useState(false)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI__' in window)) return
    const platform = navigator.platform?.toLowerCase() ?? ''
    const userAgent = navigator.userAgent?.toLowerCase() ?? ''
    setPadForMacTrafficLights(
      platform.includes('mac') || userAgent.includes('mac'),
    )
  }, [])

  useEffect(() => {
    const openCommandPalette = () => setCommandPaletteOpen(true)
    const openNewSsh = () => setHostDialogOpen(true)
    window.addEventListener('shortcut:command-palette', openCommandPalette)
    window.addEventListener('shortcut:new-ssh', openNewSsh)
    return () => {
      window.removeEventListener('shortcut:command-palette', openCommandPalette)
      window.removeEventListener('shortcut:new-ssh', openNewSsh)
    }
  }, [])

  const overlays = (
    <ToolbarOverlays
      commandPaletteOpen={commandPaletteOpen}
      hostDialogOpen={hostDialogOpen}
      notificationPanelOpen={notificationPanelOpen}
      onCommandPaletteOpenChange={setCommandPaletteOpen}
      onHostDialogOpenChange={setHostDialogOpen}
      onNotificationPanelOpenChange={setNotificationPanelOpen}
    />
  )
  const handleNewLocalTerminal = () => {
    const newTab = addTab({ label: 'Local', type: 'local' })
    navigate(`/terminal?tab=${newTab.id}`)
  }

  if (isMobile) {
    return (
      <>
        <Suspense
          fallback={
            <div className="h-12 shrink-0 border-b border-border/60 bg-background" />
          }
        >
          <MobileToolbar
            currentPath={location.pathname}
            drawerOpen={mobileDrawerOpen}
            onDrawerOpenChange={setMobileDrawerOpen}
            onNavigate={path => {
              setMobileDrawerOpen(false)
              navigate(path)
            }}
            onBack={() => navigate(-1)}
          />
        </Suspense>
        {location.pathname === '/terminal' ? (
          <div
            className="flex h-11 shrink-0 items-center gap-1 border-b border-border/60 bg-background px-1"
            data-mobile-terminal-sessions
          >
            <div className="min-w-0 flex-1 overflow-hidden">
              <MenuTabs />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={t('toolbar.newTab')}
              title={t('toolbar.newTab')}
              onClick={handleNewLocalTerminal}
              data-tauri-drag-region="false"
            >
              <Plus />
            </Button>
          </div>
        ) : null}
        {overlays}
      </>
    )
  }

  const isMac =
    typeof navigator !== 'undefined' && /mac|darwin/i.test(navigator.platform)
  const commandKeyLabel = isMac ? '⌘K' : 'Ctrl+K'
  const isSftpActive = location.pathname === '/sftp'

  return (
    <>
      <header
        className={cn(
          'flex h-11 shrink-0 items-center gap-2 border-b border-border/60 bg-background',
          padForMacTrafficLights ? 'pl-[76px] pr-3' : 'px-3',
        )}
        data-tauri-drag-region
      >
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            onClick={onToggleSidebar}
            aria-label={t('toolbar.toggleSidebar')}
            title={t('toolbar.toggleSidebar')}
            data-tauri-drag-region="false"
          >
            <PanelLeft />
          </Button>
          <WorkspaceSwitcher variant="vaults" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/sftp')}
            className={cn(
              'relative h-8 gap-1.5 rounded-md px-3',
              isSftpActive
                ? 'bg-secondary/80 text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            data-tauri-drag-region="false"
          >
            <FolderUp data-icon="inline-start" />
            {t('toolbar.sftp')}
            {activeTransferCount > 0 && (
              <CountBadge count={activeTransferCount} />
            )}
          </Button>
        </div>

        <Separator orientation="vertical" className="mx-1 h-5" />
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          <MenuTabs />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
            title={t('toolbar.newTab')}
            onClick={handleNewLocalTerminal}
            data-tauri-drag-region="false"
          >
            <Plus />
          </Button>
        </div>

        <Separator orientation="vertical" className="mx-1 h-5" />
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCommandPaletteOpen(true)}
                aria-label={t('toolbar.commandPalette')}
                className="h-8 gap-2 px-2.5 text-muted-foreground hover:text-foreground"
                data-tauri-drag-region="false"
              >
                <Search />
                <kbd className="hidden h-5 items-center rounded border border-border/60 bg-secondary/50 px-1.5 font-mono text-[10px] text-muted-foreground lg:inline-flex">
                  {commandKeyLabel}
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
                className="relative size-8 text-muted-foreground hover:text-foreground"
                onClick={() => setNotificationPanelOpen(true)}
                aria-label={t('toolbar.notifications')}
                data-tauri-drag-region="false"
              >
                <BellIcon />
                {unreadCount > 0 && <CountBadge count={unreadCount} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('toolbar.notifications')}</TooltipContent>
          </Tooltip>
        </div>
      </header>
      {overlays}
    </>
  )
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground">
      {count > 99 ? '99+' : count}
    </span>
  )
}

export default TopToolbar
