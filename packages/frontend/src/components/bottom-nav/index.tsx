import type { SerialConfig } from '@/service/serial'
import {
  ArrowLeftRight,
  Code2,
  FileText,
  Fingerprint,
  FolderUp,
  Home,
  Key,
  Keyboard,
  MoreHorizontal,
  Server,
  Settings,
  Terminal,
  Usb,
} from 'lucide-react'
import * as React from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const SerialDialog = React.lazy(() => import('@/components/serial-dialog'))
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app'

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
  path?: string
  action?: () => void
  badge?: number
}

/** Primary 5 tabs shown on the bottom bar */
const primaryItems: NavItem[] = [
  { id: 'hosts', label: 'Hosts', icon: <Home className="size-5" />, path: '/hosts' },
  { id: 'terminal', label: 'Terminal', icon: <Terminal className="size-5" />, path: '/hosts' },
  { id: 'sftp', label: 'Files', icon: <FolderUp className="size-5" />, path: '/sftp' },
  { id: 'keychain', label: 'Keys', icon: <Key className="size-5" />, path: '/keychain' },
]

/** Items in the "More" sheet */
const moreItems: NavItem[] = [
  {
    id: 'port-forward',
    label: 'Port Forward',
    icon: <ArrowLeftRight className="size-5" />,
    path: '/port-forward',
  },
  {
    id: 'snippets',
    label: 'Snippets',
    icon: <Code2 className="size-5" />,
    path: '/snippets',
  },
  {
    id: 'known-hosts',
    label: 'Known Hosts',
    icon: <Fingerprint className="size-5" />,
    path: '/known-hosts',
  },
  {
    id: 'logs',
    label: 'Logs',
    icon: <FileText className="size-5" />,
    path: '/logs',
  },
  { id: 'settings', label: 'Settings', icon: <Settings className="size-5" />, path: '/settings' },
]

const BottomNav: React.FC = () => {
  const navigate = useNavigate()
  const addTab = useAppStore(s => s.addTab)
  const tabs = useAppStore(s => s.tabs)
  const [activeId, setActiveId] = useState('hosts')
  const [moreOpen, setMoreOpen] = useState(false)
  const [serialDialogOpen, setSerialDialogOpen] = useState(false)

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
    setActiveId('terminal')
  }

  const handlePrimaryClick = (item: NavItem) => {
    setActiveId(item.id)
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
          return (
            <button
              key={item.id}
              className={cn(
                'bottom-nav-item relative flex flex-col items-center justify-center gap-0.5',
                'w-16 h-12 rounded-lg transition-colors duration-150',
                'text-muted-foreground active:scale-95',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive && 'text-foreground',
              )}
              onClick={() => handlePrimaryClick(item)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="relative">
                {item.icon}
                {isActive && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
                )}
              </span>
              <span className="text-[10px] font-medium leading-none">{item.label}</span>
            </button>
          )
        })}

        {/* Serial shortcut — open serial dialog */}
        <button
          className={cn(
            'bottom-nav-item relative flex flex-col items-center justify-center gap-0.5',
            'w-16 h-12 rounded-lg transition-colors duration-150',
            'text-muted-foreground active:scale-95',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          onClick={() => setSerialDialogOpen(true)}
          aria-label="Serial connection"
        >
          <Usb className="size-5" />
          <span className="text-[10px] font-medium leading-none">Serial</span>
        </button>

        {/* More — opens Sheet */}
        <button
          className={cn(
            'bottom-nav-item relative flex flex-col items-center justify-center gap-0.5',
            'w-16 h-12 rounded-lg transition-colors duration-150',
            'text-muted-foreground active:scale-95',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          onClick={() => setMoreOpen(true)}
          aria-label="More options"
        >
          <MoreHorizontal className="size-5" />
          <span className="text-[10px] font-medium leading-none">More</span>
        </button>
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
        <SheetContent side="bottom" className="h-[60dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
          <div className="flex flex-col gap-1 pt-2">
            <p className="px-2 pb-3 text-sm font-semibold text-muted-foreground">
              More
            </p>
            {moreItems.map(item => (
              <button
                key={item.id}
                className={cn(
                  'flex items-center gap-3 w-full px-3 py-3.5 rounded-lg',
                  'text-foreground hover:bg-accent transition-colors duration-150',
                  'active:scale-[0.98]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
                onClick={() => handleMoreItemClick(item)}
              >
                <span className="text-muted-foreground">{item.icon}</span>
                <span className="text-sm font-medium">{item.label}</span>
              </button>
            ))}

            {/* Keyboard shortcut info */}
            <div className="mt-4 px-3 py-3 rounded-lg bg-secondary/50">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Keyboard className="size-3.5" />
                <span>Command palette: Ctrl/Cmd + J</span>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export default BottomNav
