import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
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
import { Plus, Users } from 'lucide-react'

import {
  AuditLogList,
  MemberList,
  SharedHostList,
  SharedSnippetList,
} from './team-lists'
import { DisabledTeamsView } from './components/disabled-teams-view'
import { TeamDetailsHeader } from './components/team-details-header'
import { TeamListSidebar } from './components/team-list-sidebar'
import { TeamToolbar } from './components/team-toolbar'
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

  if (!isTeamEnabled) {
    return (
      <>
        <DisabledTeamsView
          onCreateTeam={() => setCreateDialogOpen(true)}
          onJoinTeam={() => setJoinDialogOpen(true)}
        />
        <CreateTeamDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
        />
        <JoinTeamDialog
          open={joinDialogOpen}
          onOpenChange={setJoinDialogOpen}
        />
      </>
    )
  }

  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <TeamToolbar
          search={search}
          onSearchChange={setSearch}
          currentTeam={currentTeam}
          userProfile={userProfile}
          isSyncing={isSyncing}
          onSync={handleSync}
          onExport={() => setExportDialogOpen(true)}
          onInvite={() => {
            setSelectedTeamId(currentTeam?.id ?? null)
            setInviteDialogOpen(true)
          }}
          onProfile={() => setProfileDialogOpen(true)}
        />
      </ViewToolbar>

      <ViewContent className="p-6">
        <div className="flex gap-6">
          <TeamListSidebar
            filteredTeams={filteredTeams}
            currentTeam={currentTeam}
            onSelectTeam={handleTeamSelect}
            onCreateTeam={() => setCreateDialogOpen(true)}
            onJoinTeam={() => setJoinDialogOpen(true)}
            search={search}
            onSearchChange={setSearch}
          />

          {/* Team Details */}
          <div className="flex-1 border-l pl-6">
            {currentTeam ? (
              <>
                {/* Team Header */}
                <TeamDetailsHeader
                  team={currentTeam}
                  lastSyncAt={lastSyncAt}
                  onSettings={() => {
                    setSelectedTeamId(currentTeam.id)
                    setSettingsDialogOpen(true)
                  }}
                />

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
