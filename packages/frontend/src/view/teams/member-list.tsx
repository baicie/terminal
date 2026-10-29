import { MoreHorizontal, Shield, Trash2 } from 'lucide-react'
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
                  {member.role === 'admin'
                    ? t('teams.admin')
                    : t('teams.member')}
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
