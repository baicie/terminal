import {
  Clock,
  Download,
  LogIn,
  Plus,
  RefreshCw,
  Settings,
  User,
  Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ViewContainer,
  ViewContent,
  ViewToolbar,
} from '@/components/view-container'
import {
  useCurrentTeam,
  useIsTeamEnabled,
  useTeams,
  useTeamStore,
} from '@/store/team'

import {
  AuditLogList,
  MemberList,
  SharedHostList,
  SharedSnippetList,
} from './team-lists'
import { CreateTeamDialog } from './create-team-dialog'
import { ExportDialog } from './export-dialog'
import { InviteDialog } from './invite-dialog'
import { JoinTeamDialog } from './join-team-dialog'
import { TeamSettingsDialog } from './team-settings-dialog'
import { UserProfileDialog } from './user-profile-dialog'

const TeamsView: React.FC = () => {
  const { t } = useTranslation()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [joinDialogOpen, setJoinDialogOpen] = useState(false)
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [, setSelectedTeamId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const isTeamEnabled = useIsTeamEnabled()
  const teams = useTeams()
  const currentTeam = useCurrentTeam()

  const loadTeams = useTeamStore(state => state.loadTeams)
  const selectTeam = useTeamStore(state => state.selectTeam)
  const members = useTeamStore(state => state.members)
  const sharedHosts = useTeamStore(state => state.sharedHosts)
  const sharedSnippets = useTeamStore(state => state.sharedSnippets)
  const auditLogs = useTeamStore(state => state.auditLogs)
  const loadMembers = useTeamStore(state => state.loadMembers)
  const loadSharedHosts = useTeamStore(state => state.loadSharedHosts)
  const loadSharedSnippets = useTeamStore(state => state.loadSharedSnippets)
  const loadAuditLogs = useTeamStore(state => state.loadAuditLogs)
  const sync = useTeamStore(state => state.sync)
  const isSyncing = useTeamStore(state => state.isSyncing)
  const lastSyncAt = useTeamStore(state => state.lastSyncAt)
  const userProfile = useTeamStore(state => state.userProfile)

  useEffect(() => {
    void loadTeams()
  }, [loadTeams])

  useEffect(() => {
    if (currentTeam) {
      void loadMembers(currentTeam.id)
      void loadSharedHosts(currentTeam.id)
      void loadSharedSnippets(currentTeam.id)
      void loadAuditLogs(currentTeam.id)
    }
  }, [
    currentTeam,
    loadMembers,
    loadSharedHosts,
    loadSharedSnippets,
    loadAuditLogs,
  ])

  const filteredTeams = teams.filter(team =>
    team.name.toLowerCase().includes(search.toLowerCase()),
  )

  const handleTeamSelect = (teamId: string) => {
    selectTeam(teamId)
  }

  const handleSync = async () => {
    await sync()
  }

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  if (!isTeamEnabled) {
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
              <Button
                onClick={() => setCreateDialogOpen(true)}
                className="w-full"
              >
                <Plus className="size-4 mr-2" />
                {t('teams.createNewTeam')}
              </Button>
              <Button
                variant="outline"
                onClick={() => setJoinDialogOpen(true)}
                className="w-full"
              >
                <LogIn className="size-4 mr-2" />
                {t('teams.joinExistingTeam')}
              </Button>
            </div>
          </div>
        </ViewContent>

        <CreateTeamDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
        />
        <JoinTeamDialog
          open={joinDialogOpen}
          onOpenChange={setJoinDialogOpen}
        />
      </ViewContainer>
    )
  }

  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <Input
          placeholder={t('common.search')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs h-9"
        />
        <div className="flex-1" />
        {userProfile && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setProfileDialogOpen(true)}
          >
            <User className="size-4 mr-1" data-icon="inline-start" />
            {userProfile.name}
          </Button>
        )}
        {currentTeam?.mode === 'cloud' && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleSync}
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
          <Button
            size="sm"
            variant="outline"
            onClick={() => setExportDialogOpen(true)}
          >
            <Download className="size-4 mr-1" data-icon="inline-start" />
            {t('teams.export')}
          </Button>
        )}
        {currentTeam && (
          <Button
            size="sm"
            onClick={() => {
              setSelectedTeamId(currentTeam.id)
              setInviteDialogOpen(true)
            }}
          >
            <Plus className="size-4 mr-1" data-icon="inline-start" />
            {t('teams.invite')}
          </Button>
        )}
      </ViewToolbar>

      <ViewContent className="p-6">
        <div className="flex gap-6">
          {/* Team List Sidebar */}
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
                    onClick={() => handleTeamSelect(team.id)}
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
                onClick={() => setCreateDialogOpen(true)}
              >
                <Plus className="size-4 mr-2" />
                {t('teams.newTeam')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-muted-foreground"
                onClick={() => setJoinDialogOpen(true)}
              >
                <LogIn className="size-4 mr-2" />
                {t('teams.joinTeam')}
              </Button>
            </div>
          </div>

          {/* Team Details */}
          <div className="flex-1 border-l pl-6">
            {currentTeam ? (
              <>
                {/* Team Header */}
                <div className="flex items-start justify-between mb-6">
                  <div className="space-y-1">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                      <Users className="size-5" />
                      {currentTeam.name}
                    </h2>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <Badge variant="outline">
                        {currentTeam.mode === 'cloud'
                          ? t('teams.cloud')
                          : t('teams.local')}
                      </Badge>
                      {currentTeam.mode === 'cloud' && currentTeam.endpoint && (
                        <span className="text-xs">{currentTeam.endpoint}</span>
                      )}
                      {lastSyncAt && (
                        <span className="flex items-center gap-1 text-xs">
                          <Clock className="size-3" />
                          {t('teams.lastSync', {
                            time: formatTime(lastSyncAt),
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSelectedTeamId(currentTeam.id)
                      setSettingsDialogOpen(true)
                    }}
                  >
                    <Settings
                      className="size-4 mr-1"
                      data-icon="inline-start"
                    />
                    {t('common.settings')}
                  </Button>
                </div>

                {/* Tabs */}
                <Tabs defaultValue="members">
                  <TabsList>
                    <TabsTrigger value="members">
                      {t('teams.members')} ({members.length})
                    </TabsTrigger>
                    <TabsTrigger value="hosts">
                      {t('teams.sharedHosts')} ({sharedHosts.length})
                    </TabsTrigger>
                    <TabsTrigger value="snippets">
                      {t('teams.sharedSnippets')} ({sharedSnippets.length})
                    </TabsTrigger>
                    <TabsTrigger value="audit">
                      {t('teams.auditLogs')} ({auditLogs.length})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="members" className="mt-4">
                    {members.length === 0 ? (
                      <p className="text-center py-8 text-muted-foreground text-sm">
                        {t('teams.noMembers')}
                      </p>
                    ) : (
                      <MemberList members={members} />
                    )}
                  </TabsContent>

                  <TabsContent value="hosts" className="mt-4">
                    {sharedHosts.length === 0 ? (
                      <p className="text-center py-8 text-muted-foreground text-sm">
                        {t('teams.noSharedHosts')}
                      </p>
                    ) : (
                      <SharedHostList hosts={sharedHosts} />
                    )}
                  </TabsContent>

                  <TabsContent value="snippets" className="mt-4">
                    {sharedSnippets.length === 0 ? (
                      <p className="text-center py-8 text-muted-foreground text-sm">
                        {t('teams.noSharedSnippets')}
                      </p>
                    ) : (
                      <SharedSnippetList snippets={sharedSnippets} />
                    )}
                  </TabsContent>

                  <TabsContent value="audit" className="mt-4">
                    {auditLogs.length === 0 ? (
                      <p className="text-center py-8 text-muted-foreground text-sm">
                        {t('teams.noAuditLogs')}
                      </p>
                    ) : (
                      <AuditLogList logs={auditLogs} />
                    )}
                  </TabsContent>
                </Tabs>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
                <Users className="size-12 text-muted-foreground/50" />
                <div>
                  <p className="text-muted-foreground">
                    {t('teams.addFirstTeam')}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('teams.addFirstTeamDesc')}
                  </p>
                </div>
                <Button onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="size-4 mr-2" />
                  {t('teams.createNewTeam')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </ViewContent>

      {/* Dialogs */}
      <CreateTeamDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
      <JoinTeamDialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen} />
      {currentTeam && (
        <>
          <InviteDialog
            open={inviteDialogOpen}
            onOpenChange={setInviteDialogOpen}
            teamId={currentTeam.id}
          />
          <ExportDialog
            open={exportDialogOpen}
            onOpenChange={setExportDialogOpen}
            teamId={currentTeam.id}
            teamName={currentTeam.name}
          />
          <TeamSettingsDialog
            open={settingsDialogOpen}
            onOpenChange={setSettingsDialogOpen}
            teamId={currentTeam.id}
          />
        </>
      )}
      <UserProfileDialog
        open={profileDialogOpen}
        onOpenChange={setProfileDialogOpen}
      />
    </ViewContainer>
  )
}

export default TeamsView
