import type { Host } from '@/types'
import {
  ChevronRight,
  Copy,
  MoreHorizontal,
  Server,
  Star,
  Trash2,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { toast } from '@/components/ui/sonner'
import { useStagger } from '@/hooks/use-stagger-animation'
import { cn } from '@/lib/utils'
import { useHostStore } from '@/store/host'

export type HostCardVariant = 'grid' | 'list' | 'mobile'

interface HostCardProps {
  host: Host
  variant: HostCardVariant
  index?: number
  isTeamEnabled?: boolean
  currentTeamId?: string
  onConnect: (host: Host) => void
  onShare?: (host: Host) => void
}

/**
 * 统一的主机卡片组件，覆盖三种渲染场景：
 * - grid : 桌面端网格
 * - list : 桌面端列表
 * - mobile : 移动端列表（带底部 Sheet 操作菜单）
 */
export const HostCard: React.FC<HostCardProps> = ({
  host,
  variant,
  index = 0,
  isTeamEnabled = false,
  currentTeamId,
  onConnect,
  onShare,
}) => {
  const { t } = useTranslation()
  const hostStore = useHostStore()
  const [sheetOpen, setSheetOpen] = useState(false)
  const staggerGrid = useStagger({ variant: 'fade-in-bottom' })
  const staggerList = useStagger({ variant: 'fade-in-right' })

  const showTeamActions = isTeamEnabled && !!currentTeamId
  const iconColor = host.color || undefined

  const handleCopySsh = () => {
    void navigator.clipboard.writeText(`${host.username}@${host.hostname}`)
    toast.success(t('common.copied'))
    setSheetOpen(false)
  }

  const handleDelete = () => {
    void hostStore.deleteHost(host.id)
    toast.success(t('common.delete'))
    setSheetOpen(false)
  }

  // ── Mobile 变体：长按 / 右键弹出 Sheet ──────────────────
  if (variant === 'mobile') {
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
            setSheetOpen(true)
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

        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
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
                label={t('hosts.connect')}
                onClick={() => {
                  setSheetOpen(false)
                  onConnect(host)
                }}
              />
              <SheetAction
                icon={<Copy className="size-5 text-muted-foreground" />}
                label={t('hosts.copySsh')}
                onClick={handleCopySsh}
              />
              {showTeamActions && onShare && (
                <SheetAction
                  icon={<Users className="size-5 text-muted-foreground" />}
                  label={t('teams.shareHost')}
                  onClick={() => {
                    setSheetOpen(false)
                    onShare(host)
                  }}
                />
              )}
              <SheetAction
                icon={<Trash2 className="size-5" />}
                label={t('common.delete')}
                destructive
                onClick={handleDelete}
              />
            </div>
          </SheetContent>
        </Sheet>
      </>
    )
  }

  // ── Desktop List 变体 ───────────────────────────────────
  if (variant === 'list') {
    const anim = staggerList(index)
    return (
      <button
        type="button"
        className={cn(
          'card-interactive flex items-center gap-3 p-3 rounded-lg',
          'border border-border/50 bg-card/80 text-left',
          anim.className,
        )}
        style={anim.style}
        onClick={() => onConnect(host)}
      >
        <Server
          className="size-5 shrink-0"
          style={iconColor ? { color: iconColor } : undefined}
        />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{host.name}</div>
          <div className="text-sm text-muted-foreground truncate">
            {t('hosts.sshAuth', { username: host.username })} · {host.hostname}
          </div>
        </div>
        {host.isFavorite && (
          <Star className="size-4 fill-warning text-warning shrink-0" />
        )}
      </button>
    )
  }

  // ── Desktop Grid 变体 ───────────────────────────────────
  const anim = staggerGrid(index)
  return (
    <div className="relative group">
      <button
        type="button"
        className={cn(
          'card-interactive text-left w-full p-4 rounded-xl',
          'border border-border/50 bg-card/80',
          anim.className,
        )}
        style={anim.style}
        onClick={() => onConnect(host)}
      >
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-lg bg-secondary/80">
            <Server
              className="size-6"
              style={iconColor ? { color: iconColor } : undefined}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium truncate">{host.name}</h3>
              {host.isFavorite && (
                <Star className="size-4 fill-warning text-warning shrink-0" />
              )}
            </div>
            <p className="text-sm text-muted-foreground truncate mt-0.5">
              {t('hosts.sshAuth', { username: host.username })}
            </p>
            <p className="text-xs text-muted-foreground/80 truncate mt-1">
              {host.username}@{host.hostname}:{host.port}
            </p>
          </div>
        </div>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 size-7 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleCopySsh}>
            <Copy className="size-4 mr-2" data-icon="inline-start" />
            {t('hosts.copySsh')}
          </DropdownMenuItem>
          {showTeamActions && onShare && (
            <DropdownMenuItem onClick={() => onShare(host)}>
              <Users className="size-4 mr-2" data-icon="inline-start" />
              {t('teams.shareHost')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-4 mr-2" data-icon="inline-start" />
            {t('common.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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

export default HostCard
