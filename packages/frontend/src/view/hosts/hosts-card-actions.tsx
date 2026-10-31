import type { Host } from '@/types'
import { Copy, MoreHorizontal, Trash2, Users } from 'lucide-react'
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
import { ResponsiveConfirm } from '@/components/ui/responsive-dialog'
import { toast } from '@/components/ui/sonner'
import { useHostStore } from '@/store/host'

interface HostCardActionsProps {
  host: Host
  showTeamActions: boolean
  onShare?: (host: Host) => void
  onCopySsh: () => void
  onRequestDelete: () => void
}

/**
 * 主机卡片右上角的「更多操作」菜单。
 *
 * 删除入口只负责**请求**删除：真正落地在 HostDeleteConfirm，那里先说明后果再执行。
 * 图标按钮必须带可访问名称，否则读屏软件只能读出「button」。
 */
export function HostCardActions({
  host,
  showTeamActions,
  onShare,
  onCopySsh,
  onRequestDelete,
}: HostCardActionsProps) {
  const { t } = useTranslation()
  const moreActionsLabel = t('hosts.moreActions', { name: host.name })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          aria-label={moreActionsLabel}
          title={moreActionsLabel}
          data-testid="host-card-actions-trigger"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onCopySsh}>
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
          onClick={onRequestDelete}
          className="text-destructive focus:text-destructive"
          data-testid="host-card-delete"
        >
          <Trash2 className="size-4 mr-2" data-icon="inline-start" />
          {t('common.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * 删除主机的确认框。只有 deleteHost 真正 resolve 之后才提示成功，
 * 失败时把后端消息原样交给用户，不做乐观提示。
 */
export function HostDeleteConfirm({
  host,
  open,
  onOpenChange,
}: {
  host: Host
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const hostStore = useHostStore()
  const [deleting, setDeleting] = useState(false)

  const handleConfirm = async () => {
    setDeleting(true)
    try {
      await hostStore.deleteHost(host.id)
      toast.success(t('hosts.deleted', { name: host.name }))
      onOpenChange(false)
    } catch (error) {
      toast.error(
        t('hosts.deleteFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      )
    } finally {
      setDeleting(false)
    }
  }

  return (
    <ResponsiveConfirm
      open={open}
      onOpenChange={onOpenChange}
      title={t('hostDialog.deleteHost')}
      description={t('hosts.deleteConfirm', { name: host.name })}
      confirmText={t('common.delete')}
      cancelText={t('common.cancel')}
      destructive
      loading={deleting}
      onConfirm={() => void handleConfirm()}
    />
  )
}
