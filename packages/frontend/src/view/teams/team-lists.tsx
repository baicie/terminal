import {
  Clock,
  MoreHorizontal,
  Shield,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useTeamStore, useUserId } from '@/store/team'

interface MemberListProps {
  members: Array<{
    id: string
    userId: string
    userName?: string
    userEmail?: string
    role: 'admin' | 'member'
  }>
}

export function MemberList({ members }: MemberListProps) {
  const { t } = useTranslation()
  const userId = useUserId()
  const isCurrentUserMember = (memberUserId: string) => memberUserId === userId

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-blue-500/10 text-blue-500 border-blue-500/20'
      default:
        return 'bg-gray-500/10 text-gray-500 border-gray-500/20'
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('common.name')}</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>{t('teams.role')}</TableHead>
          <TableHead>{t('common.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map(member => (
          <TableRow key={member.id}>
            <TableCell className="font-medium">
              {member.userName || member.userId.slice(0, 8)}
              {isCurrentUserMember(member.userId) && (
                <span className="ml-2 text-xs text-muted-foreground">
                  ({t('teams.you')})
                </span>
              )}
            </TableCell>
            <TableCell>{member.userEmail || '—'}</TableCell>
            <TableCell>
              <Badge className={getRoleBadgeColor(member.role)}>
                {t(`teams.${member.role}`)}
              </Badge>
            </TableCell>
            <TableCell>
              {!isCurrentUserMember(member.userId) ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        useTeamStore
                          .getState()
                          .updateMemberRole(
                            member.id,
                            member.role === 'admin' ? 'member' : 'admin',
                          )
                      }}
                    >
                      <Shield className="size-4 mr-2" />
                      {member.role === 'admin'
                        ? t('teams.removeAdmin')
                        : t('teams.makeAdmin')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        useTeamStore.getState().removeMember(member.id)
                      }}
                      className="text-destructive"
                    >
                      <Trash2 className="size-4 mr-2" />
                      {t('teams.removeMember')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {member.role === 'admin' ? t('teams.admin') : t('teams.member')}
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

interface SharedHost {
  id: string
  hostData: { name?: string }
  permission: 'readonly' | 'readwrite'
  sharedBy: string
}

interface SharedHostListProps {
  hosts: SharedHost[]
}

export function SharedHostList({ hosts }: SharedHostListProps) {
  const { t } = useTranslation()

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('common.name')}</TableHead>
          <TableHead>{t('teams.permissions')}</TableHead>
          <TableHead>{t('teams.sharedBy')}</TableHead>
          <TableHead>{t('common.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {hosts.map(share => {
          const hostData = share.hostData as { name?: string }
          return (
            <TableRow key={share.id}>
              <TableCell className="font-medium">
                {hostData.name || '—'}
              </TableCell>
              <TableCell>
                <Badge variant="outline">
                  {share.permission === 'readonly'
                    ? t('teams.readonly')
                    : t('teams.readwrite')}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {share.sharedBy.slice(0, 8)}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    useTeamStore.getState().unshareHost(share.id)
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

interface SharedSnippet {
  id: string
  snippetData: { name?: string }
  permission: 'readonly' | 'readwrite'
  sharedBy: string
}

interface SharedSnippetListProps {
  snippets: SharedSnippet[]
}

export function SharedSnippetList({ snippets }: SharedSnippetListProps) {
  const { t } = useTranslation()

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('common.name')}</TableHead>
          <TableHead>{t('teams.permissions')}</TableHead>
          <TableHead>{t('teams.sharedBy')}</TableHead>
          <TableHead>{t('common.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {snippets.map(share => {
          const snippetData = share.snippetData as { name?: string }
          return (
            <TableRow key={share.id}>
              <TableCell className="font-medium">
                {snippetData.name || '—'}
              </TableCell>
              <TableCell>
                <Badge variant="outline">
                  {share.permission === 'readonly'
                    ? t('teams.readonly')
                    : t('teams.readwrite')}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {share.sharedBy.slice(0, 8)}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    useTeamStore.getState().unshareSnippet(share.id)
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

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
