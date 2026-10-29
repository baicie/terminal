import type { ConnectionLogRecord } from '@/service/database/types'
import { Badge } from '@/components/ui/badge'

export function formatConnectionLogDate(timestamp: number) {
  return new Date(timestamp).toLocaleString()
}

export function formatConnectionDuration(seconds: number | null) {
  if (seconds === null || seconds === 0) return '-'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  }
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

export function ConnectionTypeBadge({ type }: { type: string }) {
  const variants: Record<string, 'default' | 'secondary' | 'outline'> = {
    ssh: 'default',
    local: 'secondary',
    serial: 'outline',
  }

  return (
    <Badge variant={variants[type] ?? 'outline'} className="text-xs">
      {type.toUpperCase()}
    </Badge>
  )
}

export function connectionLogHasError(log: ConnectionLogRecord) {
  return log.error_message !== null || log.error_raw !== null
}

export function connectionLogIsSuccess(log: ConnectionLogRecord) {
  return (
    !connectionLogHasError(log) &&
    log.duration_seconds !== null &&
    log.duration_seconds > 0
  )
}
