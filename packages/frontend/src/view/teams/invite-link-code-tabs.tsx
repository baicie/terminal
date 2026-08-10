import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TabsContent } from '@/components/ui/tabs'

export type InviteRole = 'admin' | 'member'

export interface InviteResult {
  code?: string
  linkToken?: string
}

interface InviteLinkCodeTabsProps {
  invite: InviteResult | null
  inviteLink: string
  role: InviteRole
  loading: boolean
  onRoleChange: (role: InviteRole) => void
  onCreate: () => void
  onCopy: (text: string) => void
}

function RoleSelect({
  role,
  onRoleChange,
}: Pick<InviteLinkCodeTabsProps, 'role' | 'onRoleChange'>) {
  const { t } = useTranslation()

  return (
    <div className="space-y-2">
      <Label>{t('teams.role')}</Label>
      <Select value={role} onValueChange={v => onRoleChange(v as InviteRole)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="admin">{t('teams.admin')}</SelectItem>
          <SelectItem value="member">{t('teams.member')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

export function InviteLinkCodeTabs({
  invite,
  inviteLink,
  role,
  loading,
  onRoleChange,
  onCreate,
  onCopy,
}: InviteLinkCodeTabsProps) {
  const { t } = useTranslation()
  const generateLabel = loading ? t('common.loading') : t('teams.generate')

  return (
    <>
      <TabsContent value="link" className="space-y-4 pt-4">
        <p className="text-sm text-muted-foreground">
          {t('teams.inviteLinkDesc')}
        </p>
        <RoleSelect role={role} onRoleChange={onRoleChange} />
        {invite?.linkToken ? (
          <div className="space-y-2">
            <Label>{t('teams.inviteLink')}</Label>
            <div className="flex gap-2">
              <Input
                value={inviteLink}
                readOnly
                className="font-mono text-sm"
              />
              <Button size="icon" onClick={() => onCopy(inviteLink)}>
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={onCreate} disabled={loading} className="w-full">
            {generateLabel}
          </Button>
        )}
      </TabsContent>

      <TabsContent value="code" className="space-y-4 pt-4">
        <p className="text-sm text-muted-foreground">
          {t('teams.inviteCodeDesc')}
        </p>
        <RoleSelect role={role} onRoleChange={onRoleChange} />
        {invite?.code ? (
          <div className="space-y-2">
            <Label>{t('teams.inviteCode')}</Label>
            <div className="flex gap-2">
              <Input
                value={invite.code}
                readOnly
                className="font-mono text-lg font-bold text-center tracking-widest"
              />
              <Button size="icon" onClick={() => onCopy(invite.code || '')}>
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={onCreate} disabled={loading} className="w-full">
            {generateLabel}
          </Button>
        )}
      </TabsContent>
    </>
  )
}
