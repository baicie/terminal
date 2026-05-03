import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LogIn, Plus, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface TeamListSidebarProps {
  filteredTeams: Array<{
    id: string
    name: string
    mode: 'cloud' | 'local'
  }>
  currentTeam: { id: string } | null
  onSelectTeam: (teamId: string) => void
  onCreateTeam: () => void
  onJoinTeam: () => void
  search: string
  onSearchChange: (value: string) => void
}

export const TeamListSidebar: React.FC<TeamListSidebarProps> = ({
  filteredTeams,
  currentTeam,
  onSelectTeam,
  onCreateTeam,
  onJoinTeam,
}) => {
  const { t } = useTranslation()

  return (
    <div className="w-64 shrink-0 space-y-4">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {t('teams.myTeams')}
      </h3>

      <div className="space-y-1">
        {filteredTeams.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {t('teams.noTeams')}
          </p>
        ) : (
          filteredTeams.map(team => (
            <button
              key={team.id}
              onClick={() => onSelectTeam(team.id)}
              className={`w-full text-left p-3 rounded-lg transition-colors ${
                currentTeam?.id === team.id
                  ? 'bg-secondary'
                  : 'hover:bg-secondary/50'
              }`}
            >
              <div className="flex items-center gap-2">
                <Users className="size-4 text-muted-foreground shrink-0" />
                <span className="font-medium truncate">{team.name}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-xs">
                  {team.mode === 'cloud' ? '☁️' : '📁'}{' '}
                  {team.mode === 'cloud'
                    ? t('teams.cloud')
                    : t('teams.local')}
                </Badge>
              </div>
            </button>
          ))
        )}
      </div>

      <div className="space-y-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={onCreateTeam}
        >
          <Plus className="size-4 mr-2" />
          {t('teams.newTeam')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          onClick={onJoinTeam}
        >
          <LogIn className="size-4 mr-2" />
          {t('teams.joinTeam')}
        </Button>
      </div>
    </div>
  )
}
