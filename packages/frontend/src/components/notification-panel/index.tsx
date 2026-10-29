import {
  BellIcon,
  CheckCheck,
  CircleCheckIcon,
  InfoIcon,
  OctagonXIcon,
  Trash2,
  TriangleAlertIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useNotificationStore } from '@/store/notification'
import { cn } from '@/lib/utils'

const typeConfig = {
  info: { icon: InfoIcon, className: 'text-blue-500' },
  success: { icon: CircleCheckIcon, className: 'text-green-500' },
  warning: { icon: TriangleAlertIcon, className: 'text-yellow-500' },
  error: { icon: OctagonXIcon, className: 'text-destructive' },
}

function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return new Date(timestamp).toLocaleDateString()
}

interface NotificationPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const NotificationPanel: React.FC<NotificationPanelProps> = ({
  open,
  onOpenChange,
}) => {
  const { notifications, markRead, markAllRead, removeNotification, clearAll } =
    useNotificationStore()
  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-80 flex-col p-0">
        <SheetHeader className="flex flex-row items-center justify-between border-b px-4 py-3">
          <SheetTitle className="text-base">Notifications</SheetTitle>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => markAllRead()}
              >
                <CheckCheck className="size-3.5" />
                Mark all read
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                onClick={clearAll}
              >
                <Trash2 className="size-3.5" />
                Clear all
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <BellIcon className="mb-3 size-10 opacity-30" />
              <p className="text-sm font-medium">No notifications</p>
              <p className="mt-1 text-xs">
                Connection events and script results will appear here
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {notifications.map(notif => {
                const config = typeConfig[notif.type]
                const Icon = config.icon
                return (
                  <div
                    key={notif.id}
                    className={cn(
                      'group relative flex gap-3 px-4 py-3 transition-colors',
                      !notif.read ? 'bg-accent/30 hover:bg-accent/50' : 'hover:bg-muted/40',
                    )}
                    onClick={() => markRead(notif.id)}
                  >
                    <div className={cn('mt-0.5 shrink-0', config.className)}>
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn(
                          'text-sm leading-snug',
                          !notif.read ? 'font-medium' : 'font-normal',
                        )}>
                          {notif.title}
                        </p>
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            removeNotification(notif.id)
                          }}
                          className="mt-0.5 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                        >
                          <Trash2 className="size-3 text-muted-foreground" />
                        </button>
                      </div>
                      {notif.message && (
                        <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                          {notif.message}
                        </p>
                      )}
                      <p className="mt-1.5 text-xs text-muted-foreground/70">
                        {formatTime(notif.timestamp)}
                      </p>
                    </div>
                    {!notif.read && (
                      <div className="absolute right-3 top-3.5 h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
