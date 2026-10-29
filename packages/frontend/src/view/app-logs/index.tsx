import { Download, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  ViewContainer,
  ViewContent,
  ViewHeader,
  ViewToolbar,
} from '@/components/view-container'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ConnectionLogRecord } from '@/service/database/types'
import {
  getConnectionLogs,
  clearConnectionLogs,
  toggleConnectionLogSaved,
  deleteConnectionLog,
} from '@/service/database'
import { getReadableTerminalError } from '@/features/terminal/utils/readable-error'
import { useState, useEffect } from 'react'
import { toast } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'
import {
  ConnectionTypeBadge,
  connectionLogHasError,
  connectionLogIsSuccess,
  formatConnectionDuration,
  formatConnectionLogDate,
} from './connection-log-display'

const LogsView: React.FC = () => {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<ConnectionLogRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadLogs()
  }, [])

  const loadLogs = async () => {
    setLoading(true)
    try {
      const data = await getConnectionLogs(100)
      setLogs(data)
    } catch (error) {
      console.error('Failed to load logs:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleClear = async () => {
    try {
      await clearConnectionLogs()
      await loadLogs()
      toast.success(t('common.success'))
    } catch (_error) {
      toast.error(t('common.error'))
    }
  }

  const handleToggleSaved = async (id: string) => {
    try {
      await toggleConnectionLogSaved(id)
      await loadLogs()
    } catch (_error) {
      toast.error(t('common.error'))
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteConnectionLog(id)
      await loadLogs()
      toast.success(t('common.success'))
    } catch (_error) {
      toast.error(t('common.error'))
    }
  }

  const toggleErrorExpand = (id: string) => {
    setExpandedErrors(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <Button size="sm" variant="outline" onClick={handleClear}>
          <Trash2 className="size-4 mr-1" data-icon="inline-start" />
          {t('common.clear')}
        </Button>
        <Button size="sm" variant="outline">
          <Download className="size-4 mr-1" data-icon="inline-start" />
          Export
        </Button>
      </ViewToolbar>

      <ViewContent className="p-0">
        <ViewHeader
          title={t('logs.title') ?? 'Connection Logs'}
          description="View connection and session logs"
          className="px-6 pt-6"
        />

        <ScrollArea className="h-[calc(100vh-220px)]">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              Loading...
            </div>
          ) : logs.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              {t('logs.noLogs') ?? 'No connection logs yet'}
            </div>
          ) : (
            <div className="px-6 pb-6">
              <Card className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Type</TableHead>
                      <TableHead>Host</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead className="w-20">Duration</TableHead>
                      <TableHead className="w-32">Error</TableHead>
                      <TableHead className="w-24 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map(log => (
                      <TableRow
                        key={log.id}
                        className={cn(
                          connectionLogHasError(log) && 'bg-destructive/5',
                          connectionLogIsSuccess(log) && 'bg-success/5',
                        )}
                      >
                        <TableCell>
                          <ConnectionTypeBadge type={log.connection_type} />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-sm">
                              {log.host_name}
                            </span>
                            <span className="text-xs text-muted-foreground font-mono">
                              {log.host_address}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-mono">
                          {log.username ?? '-'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatConnectionLogDate(log.started_at)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatConnectionDuration(log.duration_seconds)}
                        </TableCell>
                        <TableCell>
                          {connectionLogHasError(log) ? (
                            <div className="flex flex-col gap-1">
                              {/* 可读错误消息 */}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-sm text-destructive truncate max-w-32 block">
                                    {getReadableTerminalError(
                                      log.error_message ?? '',
                                      t,
                                    ) || log.error_message}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs">
                                  <p className="font-medium">
                                    {t('logs.readableError') ??
                                      'Readable Error'}
                                  </p>
                                  <p className="text-xs mt-1">
                                    {getReadableTerminalError(
                                      log.error_message ?? '',
                                      t,
                                    ) || log.error_message}
                                  </p>
                                </TooltipContent>
                              </Tooltip>

                              {/* 原始错误（可展开） */}
                              {log.error_raw &&
                                log.error_raw !== log.error_message && (
                                  <button
                                    onClick={() => toggleErrorExpand(log.id)}
                                    className="text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
                                  >
                                    {expandedErrors.has(log.id) ? '▲' : '▼'}{' '}
                                    {t('logs.rawError') ?? 'Raw'}
                                  </button>
                                )}

                              {expandedErrors.has(log.id) && log.error_raw && (
                                <pre className="text-xs text-muted-foreground bg-muted p-2 rounded mt-1 whitespace-pre-wrap break-all font-mono max-h-24 overflow-auto">
                                  {log.error_raw}
                                </pre>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-success">OK</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8"
                                  onClick={() => handleToggleSaved(log.id)}
                                >
                                  <span
                                    className={cn(
                                      'text-lg',
                                      log.is_saved
                                        ? 'text-warning'
                                        : 'text-muted-foreground',
                                    )}
                                  >
                                    ★
                                  </span>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {log.is_saved
                                  ? (t('logs.unsave') ?? 'Remove from saved')
                                  : (t('logs.save') ?? 'Save log')}
                              </TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 text-destructive hover:text-destructive"
                                  onClick={() => handleDelete(log.id)}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t('common.delete')}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}
        </ScrollArea>
      </ViewContent>
    </ViewContainer>
  )
}

export default LogsView
