import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DecryptDialog } from './decrypt-dialog'
import { HostsMobileToolbar } from './hosts-mobile-toolbar'
import { HostsToolbar } from './hosts-toolbar'
import { MobileToolbarSheet } from './mobile-toolbar-sheet'
import { QuickConnectDialog } from './quick-connect-dialog'
import { TeamSharedSection } from './team-shared-section'
import { useHostsViewHandlers } from './use-hosts-view-handlers'
import { RenderListBody } from './components/render-list-body'
import { HostDialog } from '@/components/host-list/host-dialog'
import SerialDialog from '@/components/serial-dialog'
import { ShareHostDialog } from '@/components/share-host-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [gridView, setGridView] = useState(true)

  const handlers = useHostsViewHandlers()
  const {
    editingHost,
    setEditingHost,
    handleEditHost,
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
    quickConnectTarget,
    setQuickConnectTarget,
    handleImportSharedSnippet,
    handleImportSharedHost,
    handleDecryptAndImport,
    handleShareHostClick,
    handleShareHost,
    handleConnect,
    handleNewLocalTerminal,
    handleQuickConnect,
    handleConnectBarSubmit,
  } = handlers

  useEffect(() => {
    // Abort the previous load when the view unmounts or retries, so a late
    // failure cannot mark a view that is already gone as broken.
    const controller = new AbortController()
    setLoading(true)
    setLoadError(null)
    void hostStore
      .loadHosts(controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    void hostStore.loadGroups().catch((error: unknown) => {
      console.error('Failed to load host groups:', error)
    })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken])

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

        {loadError ? (
          <Alert variant="destructive">
            <AlertTitle>{t('hosts.loadFailed')}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p className="font-mono text-xs break-all">{loadError}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReloadToken(token => token + 1)}
              >
                {t('common.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
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
            onEditHost={handleEditHost}
          />
        )}
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

      {/*
        `host` is what makes this an edit rather than a create: with it,
        `handleSubmit` calls `updateHost` and the form is seeded from the stored
        row. Without it the dialog has only ever been able to create.
      */}
      <HostDialog
        open={hostDialogOpen || editingHost !== null}
        host={editingHost ?? undefined}
        onClose={() => {
          setHostDialogOpen(false)
          setEditingHost(null)
        }}
      />
      <QuickConnectDialog
        open={quickConnectTarget !== null}
        target={quickConnectTarget}
        onOpenChange={open => {
          if (!open) setQuickConnectTarget(null)
        }}
        onConnect={handleQuickConnect}
      />
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
