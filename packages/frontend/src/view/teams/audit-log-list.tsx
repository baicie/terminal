import { useTranslation } from 'react-i18next'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface AuditLog {
  id: string
  userId: string
  userName?: string
  hostName?: string
  action: string
  createdAt: number
}

interface AuditLogListProps {
  logs: AuditLog[]
}

export function AuditLogList({ logs }: AuditLogListProps) {
  const { t } = useTranslation()

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('common.name')}</TableHead>
          <TableHead>Host</TableHead>
          <TableHead>{t('teams.action')}</TableHead>
          <TableHead>{t('teams.time')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map(log => (
          <TableRow key={log.id}>
            <TableCell className="font-medium">
              {log.userName || log.userId.slice(0, 8)}
            </TableCell>
            <TableCell>{log.hostName || '—'}</TableCell>
            <TableCell className="text-muted-foreground text-sm">
              {log.action}
            </TableCell>
            <TableCell className="text-muted-foreground text-sm">
              {formatTime(log.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
