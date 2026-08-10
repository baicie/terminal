import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useTeamStore } from '@/store/team'

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
