import type { Host } from '@/types'
import { Server, Star, Users, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useHostStore } from '@/store/host'
import { toast } from '@/components/ui/sonner'

interface HostCardProps {
  host: Host
  index: number
  gridView: boolean
  isTeamEnabled: boolean
  currentTeam: unknown
  onConnect: (host: Host) => void
  onShare: (host: Host) => void
}

export const HostCard: React.FC<HostCardProps> = ({
  host,
  index,
  gridView,
  isTeamEnabled,
  currentTeam,
  onConnect,
  onShare,
}) => {
  const { t } = useTranslation()
  const hostStore = useHostStore()

  if (gridView) {
    return (
      <div key={host.id} className="relative group">
        <button
          type="button"
          className="text-left w-full p-4 rounded-xl border border-border/50 bg-card/80 hover:bg-accent/40 hover:border-primary/30 hover:shadow-md hover:shadow-primary/5 cursor-pointer transition-all duration-200 hover-lift slide-in-from-bottom fade-in"
          style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
          onClick={() => onConnect(host)}
        >
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-lg bg-secondary/80">
              <Server className="size-6" style={{ color: host.color || '#888' }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-medium truncate">{host.name}</h3>
                {host.isFavorite && <Star className="size-4 fill-yellow-500 text-yellow-500 shrink-0" />}
              </div>
              <p className="text-sm text-muted-foreground truncate mt-0.5">{t('hosts.sshAuth', { username: host.username })}</p>
              <p className="text-xs text-muted-foreground/80 truncate mt-1">{host.username}@{host.hostname}:{host.port}</p>
            </div>
          </div>
        </button>
        {isTeamEnabled && currentTeam && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="absolute top-2 right-2 size-7 opacity-0 group-hover:opacity-100 transition-opacity">
                <Star className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onShare(host)}>
                <Users className="size-4 mr-2" data-icon="inline-start" />
                {t('teams.shareHost')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { void hostStore.deleteHost(host.id); toast.success(t('common.delete')) }} className="text-destructive">
                <Trash2 className="size-4 mr-2" data-icon="inline-start" />
                {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      key={host.id}
      className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card/80 hover:bg-accent/40 hover:border-primary/30 hover:shadow-sm text-left transition-all duration-200 hover-lift slide-in-from-right fade-in"
      style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
      onClick={() => onConnect(host)}
    >
      <Server className="size-5 shrink-0" style={{ color: host.color || '#888' }} />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{host.name}</div>
        <div className="text-sm text-muted-foreground truncate">{t('hosts.sshAuth', { username: host.username })} · {host.hostname}</div>
      </div>
      {host.isFavorite && <Star className="size-4 fill-yellow-500 text-yellow-500 shrink-0" />}
    </button>
  )
}
