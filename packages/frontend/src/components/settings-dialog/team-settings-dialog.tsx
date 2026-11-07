import { Check, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { TeamServerConfig } from './team-server-config'
import { useIsTeamEnabled } from '@/store/team'

interface TeamSettingsDialogProps {
  onClose: () => void
}

export function TeamSettingsDialog({ onClose }: TeamSettingsDialogProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const isTeamEnabled = useIsTeamEnabled()

  return (
    <div className="space-y-6 py-4">
      <div className="space-y-3">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Users className="size-4" />
          {t('settings.teamCollaboration')}
        </h4>
        <p className="text-sm text-muted-foreground">
          {t('settings.teamCollaborationDesc')}
        </p>

        {isTeamEnabled ? (
          <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <Check className="size-4 text-primary" />
              <span className="text-sm font-medium">{t('settings.teamModeEnabled')}</span>
            </div>
            <p className="text-xs text-muted-foreground ml-6">
              {t('settings.teamEnabledDesc')}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 ml-6"
              onClick={() => {
                onClose()
                navigate('/teams')
              }}
            >
              <Users className="size-3 mr-1" />
              {t('settings.openTeams')}
            </Button>
          </div>
        ) : (
          <div className="p-3 bg-muted rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <Users className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t('settings.teamModeDisabled')}</span>
            </div>
            <p className="text-xs text-muted-foreground ml-6">
              {t('settings.teamDisabledDesc')}
            </p>
            <Button
              size="sm"
              className="mt-3 ml-6"
              onClick={() => {
                onClose()
                navigate('/teams')
              }}
            >
              <Users className="size-3 mr-1" />
              {t('settings.enableTeam')}
            </Button>
          </div>
        )}
      </div>

      <Separator />

      <TeamServerConfig onClose={onClose} />

      <Separator />
    </div>
  )
}
