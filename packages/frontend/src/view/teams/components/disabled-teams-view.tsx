import { Button } from '@/components/ui/button'
import {
  ViewContainer,
  ViewContent,
} from '@/components/view-container'
import { LogIn, Plus, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface DisabledTeamsViewProps {
  onCreateTeam: () => void
  onJoinTeam: () => void
}

export const DisabledTeamsView: React.FC<DisabledTeamsViewProps> = ({
  onCreateTeam,
  onJoinTeam,
}) => {
  const { t } = useTranslation()

  return (
    <ViewContainer>
      <ViewContent className="p-6">
        <div className="max-w-md mx-auto space-y-8">
          <div className="text-center space-y-2">
            <Users className="size-12 mx-auto text-muted-foreground/50" />
            <h2 className="text-xl font-semibold">{t('teams.title')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('teams.enableTeamModeDesc')}
            </p>
          </div>

          <div className="space-y-3">
            <Button onClick={onCreateTeam} className="w-full">
              <Plus className="size-4 mr-2" />
              {t('teams.createNewTeam')}
            </Button>
            <Button
              variant="outline"
              onClick={onJoinTeam}
              className="w-full"
            >
              <LogIn className="size-4 mr-2" />
              {t('teams.joinExistingTeam')}
            </Button>
          </div>
        </div>
      </ViewContent>
    </ViewContainer>
  )
}
