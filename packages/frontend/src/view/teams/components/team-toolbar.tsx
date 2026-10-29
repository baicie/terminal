import { Download, Plus, RefreshCw, User } from 'lucide-react'
import type { Team, UserProfile } from '@/store/team'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslation } from 'react-i18next'

interface TeamToolbarProps {
  search: string
  onSearchChange: (value: string) => void
  currentTeam: Team | null | undefined
  userProfile: UserProfile | null | undefined
  isSyncing: boolean
  onSync: () => void
  onExport: () => void
  onInvite: () => void
  onProfile: () => void
}

export function TeamToolbar({
  search,
  onSearchChange,
  currentTeam,
  userProfile,
  isSyncing,
  onSync,
  onExport,
  onInvite,
  onProfile,
}: TeamToolbarProps) {
  const { t } = useTranslation()

  return (
    <>
      <Input
        placeholder={t('common.search')}
        value={search}
        onChange={e => onSearchChange(e.target.value)}
        className="max-w-xs h-9"
      />
      <div className="flex-1" />
      {userProfile && (
        <Button size="sm" variant="ghost" onClick={onProfile}>
          <User className="size-4 mr-1" data-icon="inline-start" />
          {userProfile.name}
        </Button>
      )}
      {currentTeam?.mode === 'cloud' && (
        <Button
          size="sm"
          variant="outline"
          onClick={onSync}
          disabled={isSyncing}
        >
          <RefreshCw
            className={`size-4 mr-1 ${isSyncing ? 'animate-spin' : ''}`}
            data-icon="inline-start"
          />
          {isSyncing ? t('teams.syncing') : t('teams.syncNow')}
        </Button>
      )}
      {currentTeam && (
        <Button size="sm" variant="outline" onClick={onExport}>
          <Download className="size-4 mr-1" data-icon="inline-start" />
          {t('teams.export')}
        </Button>
      )}
      {currentTeam && (
        <Button size="sm" onClick={onInvite}>
          <Plus className="size-4 mr-1" data-icon="inline-start" />
          {t('teams.invite')}
        </Button>
      )}
    </>
  )
}
