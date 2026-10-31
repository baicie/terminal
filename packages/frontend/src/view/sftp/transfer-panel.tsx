import { ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTransferQueue } from '@/store/transfer-queue'
import TransferRow from './transfer-row'

/**
 * 传输面板容器：只负责列表与汇总，单条记录的状态与操作在 transfer-row.tsx。
 * 并发与状态机由 service/sftp-transfer-queue.ts 裁决，这里不做任何状态写入。
 */
const TransferPanel: React.FC = () => {
  const { t } = useTranslation()
  const transfers = useTransferQueue(s => s.transfers)
  const panelOpen = useTransferQueue(s => s.panelOpen)
  const setPanelOpen = useTransferQueue(s => s.setPanelOpen)
  const togglePanel = useTransferQueue(s => s.togglePanel)
  const clearFinished = useTransferQueue(s => s.clearFinished)

  if (transfers.length === 0) return null

  const active = transfers.filter(
    t => t.status === 'running' || t.status === 'queued',
  ).length
  const errored = transfers.filter(t => t.status === 'error').length

  return (
    <div className="absolute bottom-4 right-4 w-80 max-w-[calc(100vw-2rem)] z-30 rounded-lg border bg-popover shadow-lg overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 bg-secondary/40 border-b border-border hover:bg-secondary/60 transition-colors"
        onClick={togglePanel}
      >
        <span className="text-xs font-medium flex-1 text-left">
          {t('sftp.transfersTitle')} · {transfers.length}
          {active > 0 && ` · ${t('sftp.transferActive', { count: active })}`}
          {errored > 0 && (
            <span className="ml-1 text-destructive">
              · {t('sftp.transferErrors', { count: errored })}
            </span>
          )}
        </span>
        {panelOpen ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronUp className="size-3.5 text-muted-foreground" />
        )}
      </button>

      {panelOpen && (
        <>
          <ScrollArea className="max-h-72">
            <div className="flex flex-col">
              {transfers.map(t => (
                <TransferRow key={t.id} record={t} />
              ))}
            </div>
          </ScrollArea>
          <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-t border-border bg-muted/30">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] text-muted-foreground"
              onClick={() => clearFinished()}
              disabled={transfers.every(
                t => t.status === 'running' || t.status === 'queued',
              )}
            >
              {t('sftp.clearFinished')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] text-muted-foreground"
              onClick={() => setPanelOpen(false)}
            >
              {t('common.close')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export default TransferPanel
