import type { SerialConfig } from '@/service/serial'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeftRight,
  Code2,
  FileText,
  Fingerprint,
  FolderUp,
  Home,
  Key,
  MoreHorizontal,
  Settings,
  Terminal,
  Usb,
} from 'lucide-react'
import * as React from 'react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const SerialDialog = React.lazy(() => import('@/components/serial-dialog'))
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app'

interface NavItem {
  id: string
  label: string
  icon: LucideIcon
  path?: string
  action?: () => void
}

/** Primary tabs shown on the bottom bar */
const primaryItems: NavItem[] = [
  { id: 'hosts', label: 'Hosts', icon: Home, path: '/hosts' },
  { id: 'terminal', label: 'Terminal', icon: Terminal, path: '/terminal' },
  { id: 'sftp', label: 'Files', icon: FolderUp, path: '/sftp' },
  { id: 'keychain', label: 'Keys', icon: Key, path: '/keychain' },
]

/** Items in the "More" sheet */
const moreItems: NavItem[] = [
  {
    id: 'port-forward',
    label: 'Port Forward',
    icon: ArrowLeftRight,
    path: '/port-forward',
  },
  {
    id: 'snippets',
    label: 'Snippets',
    icon: Code2,
    path: '/snippets',
  },
  {
    id: 'known-hosts',
    label: 'Known Hosts',
    icon: Fingerprint,
    path: '/known-hosts',
  },
  {
    id: 'logs',
    label: 'Logs',
    icon: FileText,
    path: '/logs',
  },
  { id: 'settings', label: 'Settings', icon: Settings, path: '/settings' },
]

function matchesRoute(pathname: string, path?: string) {
  return Boolean(path && (pathname === path || pathname.startsWith(`${path}/`)))
}

const BottomNav: React.FC = () => {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const addTab = useAppStore(s => s.addTab)
  const tabs = useAppStore(s => s.tabs)
  const [moreOpen, setMoreOpen] = useState(false)
  const [serialDialogOpen, setSerialDialogOpen] = useState(false)
  const activeId = [...primaryItems, ...moreItems].find(item =>
    matchesRoute(pathname, item.path),
  )?.id
  const moreActive = moreItems.some(item => item.id === activeId)

  const handleConnectSerial = (config: SerialConfig, sessionId: string) => {
    const portName = config.name.split('/').pop() || config.name
    const newTab = addTab({
      label: `Serial (${portName})`,
      type: 'serial',
      serialSessionId: sessionId,
      serialConfig: {
        port: config.name,
        baudRate: config.baudRate,
      },
    })
    navigate(`/terminal?tab=${newTab.id}`)
    setSerialDialogOpen(false)
  }

  const handlePrimaryClick = (item: NavItem) => {
    if (item.id === 'terminal') {
      // If no tabs, go to hosts; otherwise go to most recent terminal tab
      const lastTab = tabs[tabs.length - 1]
      if (lastTab) {
        navigate(`/terminal?tab=${lastTab.id}`)
      } else {
        navigate('/hosts')
      }
    } else if (item.path) {
      navigate(item.path)
    }
  }

  const handleMoreItemClick = (item: NavItem) => {
    setMoreOpen(false)
    if (item.path) navigate(item.path)
    if (item.action) item.action()
  }

  return (
    <>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {primaryItems.map(item => {
          const isActive = activeId === item.id
          const ItemIcon = item.icon
          return (
            <Button
              key={item.id}
              type="button"
              variant="ghost"
              className={cn(
                'bottom-nav-item relative flex flex-col items-center justify-center gap-0.5',
                'h-12 min-w-0 flex-1 shrink rounded-lg px-0 transition-colors duration-150 [&_svg]:size-5',
                'text-muted-foreground active:scale-95',
                isActive && 'active text-foreground',
              )}
              onClick={() => handlePrimaryClick(item)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <ItemIcon data-icon="inline-start" />
              <span className="text-[10px] font-medium leading-none">
                {item.label}
              </span>
            </Button>
          )
        })}

        {/* Serial shortcut — open serial dialog */}
        <Button
          type="button"
          variant="ghost"
          className={cn(
            'bottom-nav-item relative flex flex-col items-center justify-center gap-0.5',
            'h-12 min-w-0 flex-1 shrink rounded-lg px-0 transition-colors duration-150 [&_svg]:size-5',
            'text-muted-foreground active:scale-95',
          )}
          onClick={() => setSerialDialogOpen(true)}
          aria-label="Serial connection"
        >
          <Usb data-icon="inline-start" />
          <span className="text-[10px] font-medium leading-none">Serial</span>
        </Button>

        {/* More — opens Sheet */}
        <Button
          type="button"
          variant="ghost"
          className={cn(
            'bottom-nav-item relative flex flex-col items-center justify-center gap-0.5',
            'h-12 min-w-0 flex-1 shrink rounded-lg px-0 transition-colors duration-150 [&_svg]:size-5',
            'text-muted-foreground active:scale-95',
            moreActive && 'active text-foreground',
          )}
          onClick={() => setMoreOpen(true)}
          aria-label="More options"
          aria-current={moreActive ? 'page' : undefined}
        >
          <MoreHorizontal data-icon="inline-start" />
          <span className="text-[10px] font-medium leading-none">More</span>
        </Button>
      </nav>

      {serialDialogOpen && (
        <React.Suspense fallback={null}>
          <SerialDialog
            open={serialDialogOpen}
            onClose={() => setSerialDialogOpen(false)}
            onConnect={handleConnectSerial}
          />
        </React.Suspense>
      )}

      {/* More Sheet — slides from bottom */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="h-[60dvh] gap-0 pb-[env(safe-area-inset-bottom)]"
        >
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle>More</SheetTitle>
            <SheetDescription className="sr-only">
              Additional application navigation
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-1 p-2">
            {moreItems.map(item => {
              const ItemIcon = item.icon
              return (
                <Button
                  key={item.id}
                  type="button"
                  variant="ghost"
                  className="h-12 w-full justify-start gap-3 px-3 text-foreground [&_svg]:size-5"
                  onClick={() => handleMoreItemClick(item)}
                >
                  <ItemIcon data-icon="inline-start" />
                  <span>{item.label}</span>
                </Button>
              )
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export default BottomNav
