import { Copy, Link2, Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTeams, useTeamStore } from '@/store/team'

interface InviteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamId: string
}

export const InviteDialog: React.FC<InviteDialogProps> = ({
  open,
  onOpenChange,
  teamId,
}) => {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'link' | 'code' | 'email'>('link')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [invite, setInvite] = useState<{
    code?: string
    linkToken?: string
  } | null>(null)
  const [loading, setLoading] = useState(false)

  const createInvite = useTeamStore(state => state.createInvite)
  const teams = useTeams()
  const team = teams.find(t => t.id === teamId)

  useEffect(() => {
    if (!open) {
      setInvite(null)
      setEmail('')
      setTab('link')
    }
  }, [open])

  const handleCreate = async () => {
    setLoading(true)
    try {
      const result = await createInvite(
        teamId,
        tab,
        tab === 'email' ? email : undefined,
        role,
      )
      setInvite(result)
    } catch (error) {
      toast.error(String(error))
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success(t('teams.copied'))
  }

  const inviteLink = invite?.linkToken
    ? `${team?.endpoint || ''}/invite/${invite.linkToken}`
    : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t('teams.inviteMember')}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="link" className="gap-1">
              <Link2 className="size-4" />
              {t('teams.inviteLink')}
            </TabsTrigger>
            <TabsTrigger value="code" className="gap-1">
              <Copy className="size-4" />
              {t('teams.inviteCode')}
            </TabsTrigger>
            <TabsTrigger value="email" className="gap-1">
              <Mail className="size-4" />
              {t('teams.inviteEmail')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="link" className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              {t('teams.inviteLinkDesc')}
            </p>
            <div className="space-y-2">
              <Label>{t('teams.role')}</Label>
              <Select
                value={role}
                onValueChange={v => setRole(v as typeof role)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t('teams.admin')}</SelectItem>
                  <SelectItem value="member">{t('teams.member')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {invite?.linkToken ? (
              <div className="space-y-2">
                <Label>{t('teams.inviteLink')}</Label>
                <div className="flex gap-2">
                  <Input
                    value={inviteLink}
                    readOnly
                    className="font-mono text-sm"
                  />
                  <Button size="icon" onClick={() => handleCopy(inviteLink)}>
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                onClick={handleCreate}
                disabled={loading}
                className="w-full"
              >
                {loading ? t('common.loading') : t('teams.generate')}
              </Button>
            )}
          </TabsContent>

          <TabsContent value="code" className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              {t('teams.inviteCodeDesc')}
            </p>
            <div className="space-y-2">
              <Label>{t('teams.role')}</Label>
              <Select
                value={role}
                onValueChange={v => setRole(v as typeof role)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t('teams.admin')}</SelectItem>
                  <SelectItem value="member">{t('teams.member')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {invite?.code ? (
              <div className="space-y-2">
                <Label>{t('teams.inviteCode')}</Label>
                <div className="flex gap-2">
                  <Input
                    value={invite.code}
                    readOnly
                    className="font-mono text-lg font-bold text-center tracking-widest"
                  />
                  <Button
                    size="icon"
                    onClick={() => handleCopy(invite.code || '')}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                onClick={handleCreate}
                disabled={loading}
                className="w-full"
              >
                {loading ? t('common.loading') : t('teams.generate')}
              </Button>
            )}
          </TabsContent>

          <TabsContent value="email" className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              {t('teams.inviteEmailDesc')}
            </p>
            <div className="space-y-2">
              <Label htmlFor="invite-email">{t('teams.emailAddress')}</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('teams.role')}</Label>
              <Select
                value={role}
                onValueChange={v => setRole(v as typeof role)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t('teams.admin')}</SelectItem>
                  <SelectItem value="member">{t('teams.member')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleCreate}
              disabled={loading || !email.trim()}
              className="w-full"
            >
              {loading ? t('common.loading') : t('teams.sendInvite')}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
