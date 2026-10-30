import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Ban,
  CheckCircle2,
  Clock,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { cancelTransfer, removeTransfer } from '@/service/sftp-transfer'
import type { TransferRecord } from '@/store/transfer-queue'

export function formatBytes(n: number): string {
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

/**
 * 单个传输记录。
 *
 * 操作入口与状态严格对齐：排队中只能「取消排队」，运行中没有任何取消入口
 * （后端 sftp_upload/sftp_download 不支持取消，禁用而不是伪造），
 * 只有终态记录才允许移除，避免删掉记录后并发统计失真。
 */
const TransferRow: React.FC<{ record: TransferRecord }> = ({ record }) => {
  const { t } = useTranslation()
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
    ) : record.status === 'cancelled' ? (
      <Ban className="size-3.5 text-muted-foreground" />
    ) : record.status === 'queued' ? (
      <Clock className="size-3.5 text-muted-foreground" />
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
        <span
          className="text-xs font-medium truncate flex-1"
          title={record.remotePath}
        >
          {record.name}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {record.bytesTotal > 0
            ? `${formatBytes(record.bytesDone)} / ${formatBytes(record.bytesTotal)}`
            : formatBytes(record.bytesDone)}
        </span>
        {record.status === 'queued' && (
          <Button
            variant="ghost"
            size="icon"
            className="size-5 opacity-0 group-hover:opacity-100"
            onClick={() => cancelTransfer(record.id)}
            title={t('sftp.transferCancelQueued')}
          >
            <Ban className="size-3" />
          </Button>
        )}
        {record.status === 'running' && (
          <Button
            variant="ghost"
            size="icon"
            className="size-5"
            disabled
            title={t('sftp.transferCancelUnsupported')}
          >
            <Ban className="size-3" />
          </Button>
        )}
        {record.status !== 'queued' && record.status !== 'running' && (
          <Button
            variant="ghost"
            size="icon"
            className="size-5 opacity-0 group-hover:opacity-100"
            onClick={() => removeTransfer(record.id)}
            title={t('common.delete')}
          >
            <X className="size-3" />
          </Button>
        )}
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
        <div
          className="text-[10px] text-destructive truncate"
          title={record.message}
        >
          {record.message}
        </div>
      )}
      {record.status === 'done' && (
        <div className="text-[10px] text-success">{t('sftp.transferDone')}</div>
      )}
      {record.status === 'queued' && (
        <div className="text-[10px] text-muted-foreground">
          {t('sftp.transferQueued')}
        </div>
      )}
      {record.status === 'cancelled' && (
        <div className="text-[10px] text-muted-foreground">
          {t('sftp.transferCancelled')}
        </div>
      )}
    </div>
  )
}

export default TransferRow
