import { Clock, Settings, Users } from 'lucide-react'
import type { Team } from '@/store/team'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'

interface TeamDetailsHeaderProps {
  team: Team
  lastSyncAt: number | null | undefined
  onSettings: () => void
}

export function TeamDetailsHeader({
  team,
  lastSyncAt,
  onSettings,
}: TeamDetailsHeaderProps) {
  const { t } = useTranslation()

  const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleString()

  return (
    <div className="flex items-start justify-between mb-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Users className="size-5" />
          {team.name}
        </h2>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Badge variant="outline">
            {team.mode === 'cloud'
              ? t('teams.cloud')
              : t('teams.local')}
          </Badge>
          {team.mode === 'cloud' && team.endpoint && (
            <span className="text-xs">{team.endpoint}</span>
          )}
          {lastSyncAt && (
            <span className="flex items-center gap-1 text-xs">
              <Clock className="size-3" />
              {t('teams.lastSync', { time: formatTime(lastSyncAt) })}
            </span>
          )}
        </div>
      </div>
      <Button size="sm" variant="ghost" onClick={onSettings}>
        <Settings
          className="size-4 mr-1"
          data-icon="inline-start"
        />
        {t('common.settings')}
      </Button>
    </div>
  )
}
