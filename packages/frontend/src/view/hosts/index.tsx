import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DecryptDialog } from './decrypt-dialog'
import { HostsMobileToolbar } from './hosts-mobile-toolbar'
import { HostsToolbar } from './hosts-toolbar'
import { MobileToolbarSheet } from './mobile-toolbar-sheet'
import { TeamSharedSection } from './team-shared-section'
import { useHostsViewHandlers } from './use-hosts-view-handlers'
import { RenderListBody } from './components/render-list-body'
import { HostDialog } from '@/components/host-list/host-dialog'
import SerialDialog from '@/components/serial-dialog'
import { ShareHostDialog } from '@/components/share-host-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import FAB from '@/components/ui/fab'
import {
  ViewContainer,
  ViewContent,
  ViewHeader,
} from '@/components/view-container'
import { useIsMobile } from '@/hooks/use-breakpoint'
import { cn } from '@/lib/utils'
import { useHostStore } from '@/store/host'
import { useCurrentTeam, useIsTeamEnabled, useTeamStore } from '@/store/team'

const HostsView: React.FC = () => {
  const { t } = useTranslation()
  const hostStore = useHostStore()
  const hosts = useHostStore(s => s.hosts)
  const isTeamEnabled = useIsTeamEnabled()
  const currentTeam = useCurrentTeam()
  const sharedHosts = useTeamStore(s => s.sharedHosts)
  const sharedSnippets = useTeamStore(s => s.sharedSnippets)
  const isMobile = useIsMobile()

  const [hostDialogOpen, setHostDialogOpen] = useState(false)
  const [mobileToolbarOpen, setMobileToolbarOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [gridView, setGridView] = useState(true)

  const handlers = useHostsViewHandlers()
  const {
    shareDialogOpen,
    setShareDialogOpen,
    shareDialogHost,
    decryptDialogOpen,
    setDecryptDialogOpen,
    decryptPassword,
    setDecryptPassword,
    decryptingHost,
    serialDialogOpen,
    setSerialDialogOpen,
    handleImportSharedSnippet,
    handleImportSharedHost,
    handleDecryptAndImport,
    handleShareHostClick,
    handleShareHost,
    handleConnect,
    handleNewLocalTerminal,
    handleConnectBarSubmit,
  } = handlers

  useEffect(() => {
    setLoading(true)
    void hostStore.loadHosts().finally(() => setLoading(false))
    void hostStore.loadGroups()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isTeamEnabled && currentTeam) {
      void useTeamStore.getState().loadSharedHosts(currentTeam.id)
      void useTeamStore.getState().loadSharedSnippets(currentTeam.id)
    }
  }, [isTeamEnabled, currentTeam])

  const filteredHosts = hosts.filter(
    host =>
      host.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      host.hostname.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <ViewContainer>
      {isMobile ? (
        <HostsMobileToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onConnectBarSubmit={handleConnectBarSubmit}
          onOpenMobileSheet={() => setMobileToolbarOpen(true)}
          gridView={gridView}
          onGridViewChange={setGridView}
        />
      ) : (
        <HostsToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onConnectBarSubmit={handleConnectBarSubmit}
          onOpenHostDialog={() => setHostDialogOpen(true)}
          onNewLocalTerminal={handleNewLocalTerminal}
          onOpenSerialDialog={() => setSerialDialogOpen(true)}
          gridView={gridView}
          onGridViewChange={setGridView}
        />
      )}

      <ViewContent
        className={cn(
          'flex flex-col min-h-0',
          isMobile ? 'p-0 gap-2' : 'p-4 sm:p-6 gap-4',
        )}
      >
        <TeamSharedSection
          isMobile={isMobile}
          sharedHosts={sharedHosts}
          sharedSnippets={sharedSnippets}
          isTeamEnabled={isTeamEnabled}
          currentTeamId={currentTeam?.id}
          onImportSharedHost={handleImportSharedHost}
          onImportSharedSnippet={handleImportSharedSnippet}
        />

        {!isTeamEnabled && (
          <div className={cn(isMobile && 'px-3 pt-3')}>
            <Alert className="border-border/60 bg-secondary/20 py-3">
              <AlertTitle className="text-sm font-medium">
                {t('hosts.inviteMembers')}
              </AlertTitle>
              <AlertDescription className="text-xs text-muted-foreground">
                {t('hosts.inviteDesc')}
              </AlertDescription>
            </Alert>
          </div>
        )}

        {isMobile ? (
          <div className="px-3 pt-1 pb-2">
            <p className="text-xs text-muted-foreground">
              {t('hosts.count', { count: filteredHosts.length })}
            </p>
          </div>
        ) : (
          <ViewHeader
            title={t('hosts.title')}
            description={t('hosts.count', { count: filteredHosts.length })}
            className="slide-in-from-bottom fade-in"
          />
        )}

        <RenderListBody
          loading={loading}
          filteredHosts={filteredHosts}
          searchQuery={searchQuery}
          isMobile={isMobile}
          gridView={gridView}
          isTeamEnabled={isTeamEnabled}
          currentTeamId={currentTeam?.id}
          onConnect={handleConnect}
          onShareHostClick={handleShareHostClick}
          onAddHost={() => setHostDialogOpen(true)}
        />
      </ViewContent>

      {isMobile && (
        <>
          <FAB
            onClick={() => setHostDialogOpen(true)}
            title={t('hosts.addHost')}
          />
          <MobileToolbarSheet
            open={mobileToolbarOpen}
            onOpenChange={setMobileToolbarOpen}
            onNewHost={() => setHostDialogOpen(true)}
            onNewLocalTerminal={handleNewLocalTerminal}
            onSerialConnect={() => setSerialDialogOpen(true)}
          />
        </>
      )}

      <HostDialog open={hostDialogOpen} onClose={() => setHostDialogOpen(false)} />
      <SerialDialog
        open={serialDialogOpen}
        onClose={() => setSerialDialogOpen(false)}
        onConnect={handlers.handleConnectSerial}
      />
      <ShareHostDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        host={shareDialogHost}
        onShare={handleShareHost}
      />
      <DecryptDialog
        open={decryptDialogOpen}
        onOpenChange={setDecryptDialogOpen}
        hostName={
          decryptingHost
            ? ((decryptingHost.hostData as Record<string, unknown>).name as string)
            : ''
        }
        password={decryptPassword}
        onPasswordChange={setDecryptPassword}
        onDecrypt={handleDecryptAndImport}
      />
    </ViewContainer>
  )
}

export default HostsView
