import type { Host } from '@/types'
import { ChevronRight, Copy, Server, Star, Trash2, Users } from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

interface MobileHostCardProps {
  host: Host
  iconColor?: string
  sheetOpen: boolean
  showTeamActions: boolean
  labels: {
    connect: string
    copySsh: string
    share: string
    delete: string
  }
  onSheetOpenChange: (open: boolean) => void
  onConnect: (host: Host) => void
  onShare?: (host: Host) => void
  onCopySsh: () => void
  onDelete: () => void
}

export function MobileHostCard({
  host,
  iconColor,
  sheetOpen,
  showTeamActions,
  labels,
  onSheetOpenChange,
  onConnect,
  onShare,
  onCopySsh,
  onDelete,
}: MobileHostCardProps) {
  return (
    <>
      <button
        type="button"
        className={cn(
          'card-interactive w-full flex items-center gap-3 px-4 py-3.5 rounded-xl',
          'bg-card border border-border/50 text-left',
          'active:scale-[0.98] active:bg-accent/40',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
        onClick={() => onConnect(host)}
        onContextMenu={e => {
          e.preventDefault()
          onSheetOpenChange(true)
        }}
      >
        <Server
          className="size-6 shrink-0"
          style={iconColor ? { color: iconColor } : undefined}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-sm truncate">{host.name}</span>
            {host.isFavorite && (
              <Star className="size-3.5 fill-warning text-warning shrink-0" />
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {host.username}@{host.hostname}:{host.port}
          </p>
        </div>
        <ChevronRight className="size-4 text-muted-foreground/60 shrink-0" />
      </button>

      <Sheet open={sheetOpen} onOpenChange={onSheetOpenChange}>
        <SheetContent
          side="bottom"
          className="h-auto max-h-[60dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
        >
          <div className="flex flex-col gap-1 pt-2">
            <div className="px-2 pb-3 border-b border-border/60">
              <p className="text-sm font-semibold truncate">{host.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {host.username}@{host.hostname}:{host.port}
              </p>
            </div>

            <SheetAction
              icon={<Server className="size-5 text-primary" />}
              label={labels.connect}
              onClick={() => {
                onSheetOpenChange(false)
                onConnect(host)
              }}
            />
            <SheetAction
              icon={<Copy className="size-5 text-muted-foreground" />}
              label={labels.copySsh}
              onClick={onCopySsh}
            />
            {showTeamActions && onShare && (
              <SheetAction
                icon={<Users className="size-5 text-muted-foreground" />}
                label={labels.share}
                onClick={() => {
                  onSheetOpenChange(false)
                  onShare(host)
                }}
              />
            )}
            <SheetAction
              icon={<Trash2 className="size-5" />}
              label={labels.delete}
              destructive
              onClick={onDelete}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

interface SheetActionProps {
  icon: React.ReactNode
  label: string
  destructive?: boolean
  onClick: () => void
}

const SheetAction: React.FC<SheetActionProps> = ({
  icon,
  label,
  destructive,
  onClick,
}) => (
  <button
    type="button"
    className={cn(
      'flex items-center gap-3 w-full px-3 py-3.5 rounded-lg transition-colors active:scale-[0.98]',
      destructive
        ? 'text-destructive hover:bg-destructive/10'
        : 'text-foreground hover:bg-accent',
    )}
    onClick={onClick}
  >
    {icon}
    <span className="text-sm font-medium">{label}</span>
  </button>
)
