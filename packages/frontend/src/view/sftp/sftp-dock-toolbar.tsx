import { RefreshCw, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ViewToolbar } from '@/components/view-container'
import { cn } from '@/lib/utils'

/**
 * The toolbar above the file panes.
 *
 * Its own file for two reasons: `sftp-container.tsx` is at its size limit, and the
 * pinned-host indicator is the visible half of `INV-13` — a reader looking for
 * "which host is this showing, and why is it not the tab I am in" should find it
 * without scrolling past the upload and dialog wiring.
 */
export interface SftpDockToolbarProps {
  boundHostName: string
  /** True when the active tab is a different host than the pinned one. */
  followsAnotherTab: boolean
  loading: boolean
  onFollowActiveTab: () => void
  onRefresh: () => void
}

export function SftpDockToolbar({
  boundHostName,
  followsAnotherTab,
  loading,
  onFollowActiveTab,
  onRefresh,
}: SftpDockToolbarProps) {
  const { t } = useTranslation()
  return (
    <ViewToolbar className="gap-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Server className="size-4" />
        <span data-testid="sftp-bound-host">{boundHostName}</span>
      </div>
      {/* `INV-13`: the panel is pinned to a host. When the active tab is a
          different one, say so and offer to follow it — never repoint on our own,
          because a delete or a rename is aimed at whatever this panel shows. */}
      {followsAnotherTab ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          data-testid="sftp-follow-active-tab"
          onClick={onFollowActiveTab}
        >
          {t('sftp.followActiveTab')}
        </Button>
      ) : null}
      <div className="flex-1" />
      <Button variant="outline" size="sm" onClick={onRefresh}>
        <RefreshCw className={cn('size-4 mr-1', loading && 'animate-spin')} />
        {t('sftp.refresh')}
      </Button>
    </ViewToolbar>
  )
}
