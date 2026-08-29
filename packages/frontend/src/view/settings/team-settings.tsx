import { useNavigate } from 'react-router-dom'
import { Check, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useIsTeamEnabled } from '@/store/team'

export function TeamSettings() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isTeamEnabled = useIsTeamEnabled()

  return (
    <div className="bg-card rounded-lg border p-4 space-y-4">
      <h3 className="text-sm font-medium flex items-center gap-2">
        <Users className="h-4 w-4" />
        {t('settings.teamCollaboration')}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t('settings.teamCollaborationDesc')}
      </p>

      {isTeamEnabled ? (
        <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <Check className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">
              {t('settings.teamEnabled')}
            </span>
          </div>
          <p className="text-xs text-muted-foreground ml-6">
            {t('settings.teamEnabledDesc')}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 ml-6"
            onClick={() => navigate('/teams')}
          >
            <Users className="h-3 w-3 mr-1" />
            {t('settings.openTeams')}
          </Button>
        </div>
      ) : (
        <div className="p-3 bg-muted rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {t('settings.teamDisabled')}
            </span>
          </div>
          <p className="text-xs text-muted-foreground ml-6">
            {t('settings.teamDisabledDesc')}
          </p>
          <Button
            size="sm"
            className="mt-3 ml-6"
            onClick={() => navigate('/teams')}
          >
            <Users className="h-3 w-3 mr-1" />
            {t('settings.enableTeam')}
          </Button>
        </div>
      )}

      <Separator />

      {/* Team Server Config */}
      <TeamServerConfig onClose={() => {}} />
    </div>
  )
}

// Lazy import to avoid circular dependency
import { TeamServerConfig } from './team-server-config'
