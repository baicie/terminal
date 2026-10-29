import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  type TransferRecord,
  useTransferQueue,
} from '@/store/transfer-queue'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec < 1) return ''
  return `${formatBytes(bytesPerSec)}/s`
}

function formatEta(remainingBytes: number, bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec < 1 || remainingBytes <= 0) return ''
  const sec = Math.round(remainingBytes / bytesPerSec)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  return `${Math.round(sec / 3600)}h`
}

interface RowProps {
  record: TransferRecord
}

const TransferRow: React.FC<RowProps> = ({ record }) => {
  const { t } = useTranslation()
  const remove = useTransferQueue(s => s.remove)
  const pct =
    record.bytesTotal > 0
      ? Math.min(100, Math.round((record.bytesDone / record.bytesTotal) * 100))
      : record.status === 'done'
        ? 100
        : 0

  const statusIcon =
    record.status === 'error' ? (
      <AlertCircle className="size-3.5 text-destructive" />
    ) : record.status === 'done' ? (
      <CheckCircle2 className="size-3.5 text-success" />
    ) : record.kind === 'upload' ? (
      <ArrowUp className="size-3.5 text-primary" />
    ) : (
      <ArrowDown className="size-3.5 text-primary" />
    )

  const remaining = Math.max(0, record.bytesTotal - record.bytesDone)
  const eta = formatEta(remaining, record.speed)
  const speed = formatSpeed(record.speed)

  return (
    <div
      className={cn(
        'group flex flex-col gap-1 px-3 py-2 border-b border-border/40 last:border-b-0',
        record.status === 'error' && 'bg-destructive/5',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        {statusIcon}
        <span className="text-xs font-medium truncate flex-1" title={record.remotePath}>
          {record.name}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {record.bytesTotal > 0
            ? `${formatBytes(record.bytesDone)} / ${formatBytes(record.bytesTotal)}`
            : formatBytes(record.bytesDone)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-5 opacity-0 group-hover:opacity-100"
          onClick={() => remove(record.id)}
          title={t('common.delete')}
        >
          <X className="size-3" />
        </Button>
      </div>
      {record.status === 'running' && (
        <>
          <Progress value={pct} className="h-1" />
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{pct}%</span>
            <span className="tabular-nums">
              {speed}
              {speed && eta && ' · '}
              {eta && t('sftp.transferEta', { eta })}
            </span>
          </div>
        </>
      )}
      {record.status === 'error' && (
        <div className="text-[10px] text-destructive truncate" title={record.message}>
          {record.message}
        </div>
      )}
      {record.status === 'done' && (
        <div className="text-[10px] text-success">
          {t('sftp.transferDone')}
        </div>
      )}
    </div>
  )
}

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
      {/* Header */}
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

      {/* Body */}
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
