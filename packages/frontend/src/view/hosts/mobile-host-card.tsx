import type { Host } from '@/types'
import {
  ChevronRight,
  Copy,
  Edit2,
  Server,
  Star,
  Trash2,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet'
import { toast } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'
import { useHostStore } from '@/store/host'
import { useIsTeamEnabled, useCurrentTeam } from '@/store/team'

interface MobileHostCardProps {
  host: Host
  onConnect: (host: Host) => void
  onShare?: (host: Host) => void
}

const MobileHostCard: React.FC<MobileHostCardProps> = ({
  host,
  onConnect,
  onShare,
}) => {
  const { t } = useTranslation()
  const hostStore = useHostStore()
  const isTeamEnabled = useIsTeamEnabled()
  const currentTeam = useCurrentTeam()
  const [sheetOpen, setSheetOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3.5 rounded-xl',
          'bg-card border border-border/50',
          'active:scale-[0.98] active:bg-accent/40',
          'transition-all duration-150 text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
        onClick={() => onConnect(host)}
        onContextMenu={e => {
          e.preventDefault()
          setSheetOpen(true)
        }}
        onLongPress={() => setSheetOpen(true)}
      >
        {/* Host icon */}
        <div className="shrink-0">
          <Server
            className="size-6"
            style={{ color: host.color || 'var(--muted-foreground)' }}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-sm truncate">{host.name}</span>
            {host.isFavorite && (
              <Star className="size-3.5 fill-yellow-500 text-yellow-500 shrink-0" />
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {host.username}@{host.hostname}:{host.port}
          </p>
        </div>

        {/* Quick action */}
        <div className="shrink-0">
          <ChevronRight className="size-4 text-muted-foreground/60" />
        </div>
      </button>

      {/* Long-press / context action sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="h-auto max-h-[60dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
          <div className="flex flex-col gap-1 pt-2">
            {/* Host name header */}
            <div className="px-2 pb-3 border-b border-border/60">
              <p className="text-sm font-semibold truncate">{host.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {host.username}@{host.hostname}:{host.port}
              </p>
            </div>

            {/* Connect */}
            <button
              className="flex items-center gap-3 w-full px-3 py-3.5 rounded-lg text-foreground hover:bg-accent transition-colors active:scale-[0.98]"
              onClick={() => {
                setSheetOpen(false)
                onConnect(host)
              }}
            >
              <Server className="size-5 text-primary" />
              <span className="text-sm font-medium">{t('hosts.connect')}</span>
            </button>

            {/* Copy IP */}
            <button
              className="flex items-center gap-3 w-full px-3 py-3.5 rounded-lg text-foreground hover:bg-accent transition-colors active:scale-[0.98]"
              onClick={() => {
                void navigator.clipboard.writeText(`${host.username}@${host.hostname}`)
                toast.success('Copied to clipboard')
                setSheetOpen(false)
              }}
            >
              <Copy className="size-5 text-muted-foreground" />
              <span className="text-sm">Copy SSH command</span>
            </button>

            {/* Share (team only) */}
            {isTeamEnabled && currentTeam && onShare && (
              <button
                className="flex items-center gap-3 w-full px-3 py-3.5 rounded-lg text-foreground hover:bg-accent transition-colors active:scale-[0.98]"
                onClick={() => {
                  setSheetOpen(false)
                  onShare(host)
                }}
              >
                <Users className="size-5 text-muted-foreground" />
                <span className="text-sm">Share</span>
              </button>
            )}

            {/* Delete */}
            <button
              className="flex items-center gap-3 w-full px-3 py-3.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors active:scale-[0.98]"
              onClick={() => {
                void hostStore.deleteHost(host.id)
                toast.success(t('common.delete'))
                setSheetOpen(false)
              }}
            >
              <Trash2 className="size-5" />
              <span className="text-sm">{t('common.delete')}</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export default MobileHostCard
