import { Package, Wifi } from 'lucide-react'
import { useState } from 'react'
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
import { useTeamStore } from '@/store/team'

interface CreateTeamDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const CreateTeamDialog: React.FC<CreateTeamDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'local' | 'cloud'>('local')
  const [endpoint, setEndpoint] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [loading, setLoading] = useState(false)

  const createTeam = useTeamStore(state => state.createTeam)
  const updateTeam = useTeamStore(state => state.updateTeam)
  const enableTeamMode = useTeamStore(state => state.enableTeamMode)

  const handleCreate = async () => {
    if (!name.trim()) return

    setLoading(true)
    try {
      await createTeam(name.trim(), mode)

      if (mode === 'cloud' && endpoint) {
        const teams = useTeamStore.getState().teams
        const createdTeam = teams.find(t => t.name === name.trim())
        if (createdTeam) {
          await updateTeam(createdTeam.id, {
            mode: 'cloud',
            endpoint,
            apiToken,
          })
        }
      }

      await enableTeamMode({ mode, endpoint, apiToken })
      toast.success(t('teams.teamCreated'))
      onOpenChange(false)
      setName('')
      setMode('local')
      setEndpoint('')
      setApiToken('')
    } catch (error) {
      toast.error(String(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t('teams.createTeam')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="team-name">{t('teams.teamName')}</Label>
            <Input
              id="team-name"
              placeholder={t('teams.teamName')}
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>{t('teams.connectionMode')}</Label>
            <div className="space-y-2">
              <button
                type="button"
                className={`flex items-start gap-3 w-full p-3 border rounded-lg cursor-pointer transition-colors ${
                  mode === 'local'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
                onClick={() => setMode('local')}
              >
                <Package
                  className={`mt-0.5 ${mode === 'local' ? 'text-primary' : 'text-muted-foreground'}`}
                />
                <div className="text-left">
                  <div className="font-medium">{t('teams.localMode')}</div>
                  <div className="text-sm text-muted-foreground">
                    {t('teams.localModeDesc')}
                  </div>
                </div>
              </button>
              <button
                type="button"
                className={`flex items-start gap-3 w-full p-3 border rounded-lg cursor-pointer transition-colors ${
                  mode === 'cloud'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
                onClick={() => setMode('cloud')}
              >
                <Wifi
                  className={`mt-0.5 ${mode === 'cloud' ? 'text-primary' : 'text-muted-foreground'}`}
                />
                <div className="text-left">
                  <div className="font-medium">{t('teams.cloudMode')}</div>
                  <div className="text-sm text-muted-foreground">
                    {t('teams.cloudModeDesc')}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {mode === 'cloud' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="endpoint">{t('teams.serverEndpoint')}</Label>
                <Input
                  id="endpoint"
                  placeholder="https://team.example.com"
                  value={endpoint}
                  onChange={e => setEndpoint(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="api-token">{t('teams.apiToken')}</Label>
                <Input
                  id="api-token"
                  type="password"
                  placeholder="••••••••"
                  value={apiToken}
                  onChange={e => setApiToken(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || loading}>
            {loading ? t('common.loading') : t('teams.createTeam')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
