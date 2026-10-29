import { Trash2, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTeams, useTeamStore } from '@/store/team'

interface TeamSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamId: string
}

export const TeamSettingsDialog: React.FC<TeamSettingsDialogProps> = ({
  open,
  onOpenChange,
  teamId,
}) => {
  const { t } = useTranslation()
  const teams = useTeams()
  const team = teams.find(t => t.id === teamId)

  const updateTeam = useTeamStore(state => state.updateTeam)
  const deleteTeam = useTeamStore(state => state.deleteTeam)
  const disableTeamMode = useTeamStore(state => state.disableTeamMode)

  const [name, setName] = useState(team?.name || '')
  const [endpoint, setEndpoint] = useState(team?.endpoint || '')
  const [apiToken, setApiToken] = useState(team?.apiToken || '')
  const [autoSync, setAutoSync] = useState(team?.autoSync || false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (team) {
      setName(team.name)
      setEndpoint(team.endpoint || '')
      setApiToken(team.apiToken || '')
      setAutoSync(team.autoSync)
    }
  }, [team])

  const handleSave = async () => {
    setLoading(true)
    try {
      await updateTeam(teamId, {
        name,
        endpoint,
        apiToken,
        autoSync,
      })
      toast.success(t('common.success'))
      onOpenChange(false)
    } catch (error) {
      toast.error(String(error))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (window.confirm(t('teams.deleteTeamConfirm'))) {
      await deleteTeam(teamId)
      toast.success(t('common.success'))
      onOpenChange(false)
    }
  }

  const handleDisableTeamMode = async () => {
    if (window.confirm(t('teams.disableConfirm'))) {
      await disableTeamMode()
      toast.success(t('teams.teamModeDisabled'))
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('teams.teamSettings')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="settings-name">{t('common.name')}</Label>
            <Input
              id="settings-name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          {team?.mode === 'cloud' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="settings-endpoint">
                  {t('teams.serverEndpoint')}
                </Label>
                <Input
                  id="settings-endpoint"
                  value={endpoint}
                  onChange={e => setEndpoint(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-token">{t('teams.apiToken')}</Label>
                <Input
                  id="settings-token"
                  type="password"
                  value={apiToken}
                  onChange={e => setApiToken(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="pt-2 border-t space-y-3">
            <button
              type="button"
              onClick={handleDisableTeamMode}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <WifiOff className="size-4" />
              {t('teams.disableTeamMode')}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="flex items-center gap-2 text-sm text-destructive hover:text-destructive/80 transition-colors"
            >
              <Trash2 className="size-4" />
              {t('teams.deleteTeam')}
            </button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
