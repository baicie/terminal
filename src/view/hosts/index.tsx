import {
  ChevronDown,
  LayoutGrid,
  List,
  Plus,
  Server,
  Terminal,
  Usb,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MobileToolbarSheet } from './mobile-toolbar-sheet'
import { TeamSharedSection } from './team-shared-section'
import { DecryptDialog } from './decrypt-dialog'
import { HostListView } from './host-list-view'
import MobileHostCard from './mobile-host-card'
import { HostDialog } from '@/components/host-list/host-dialog'
import SerialDialog from '@/components/serial-dialog'
import { ShareHostDialog } from '@/components/share-host-dialog'
import FAB from '@/components/ui/fab'
import { HostListSkeleton } from '@/components/ui/view-skeletons'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  EmptyState,
  ViewContainer,
  ViewContent,
  ViewHeader,
} from '@/components/view-container'
import { useIsMobile } from '@/hooks/use-breakpoint'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { useCurrentTeam, useIsTeamEnabled, useTeamStore } from '@/store/team'
import { useHostsViewHandlers } from './use-hosts-view-handlers'

const HostsView: React.FC = () => {
  const { t } = useTranslation()
  const app = useAppStore()
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

  if (isMobile) {
    return (
      <ViewContainer>
        <div className="shrink-0 border-b border-border/60 bg-background px-3 py-2.5 flex flex-col gap-2">
          <Input
            placeholder={t('hosts.search')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="h-10 w-full rounded-lg bg-secondary/40 border-border/60"
          />
          <div className="flex items-center gap-2 overflow-x-auto">
            <Button
              variant="secondary"
              size="sm"
              className="gap-1 shrink-0 h-8 text-xs"
              onClick={() => setMobileToolbarOpen(true)}
            >
              <Plus className="size-3.5" data-icon="inline-start" />
              New
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 shrink-0 h-8 text-xs"
              onClick={() => {
                const q = searchQuery.trim()
                if (q) handleConnectBarSubmit(q)
              }}
            >
              <Terminal className="size-3.5" data-icon="inline-start" />
              Connect
            </Button>
            <div className="flex items-center gap-0.5 ml-auto shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className={cn('size-8 rounded-md', gridView && 'bg-secondary/80')}
                onClick={() => setGridView(true)}
              >
                <LayoutGrid className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('size-8 rounded-md', !gridView && 'bg-secondary/80')}
                onClick={() => setGridView(false)}
              >
                <List className="size-4" />
              </Button>
            </div>
          </div>
        </div>

        <ViewContent className="p-0 flex flex-col gap-2 min-h-0">
          <TeamSharedSection
            isMobile
            sharedHosts={sharedHosts}
            sharedSnippets={sharedSnippets}
            isTeamEnabled={isTeamEnabled}
            currentTeamId={currentTeam?.id}
            onImportSharedHost={handleImportSharedHost}
            onImportSharedSnippet={handleImportSharedSnippet}
          />

          {!isTeamEnabled && (
            <div className="px-3 pt-3">
              <Alert className="border-border/60 bg-secondary/20 py-3">
                <AlertTitle className="text-sm font-medium">{t('hosts.inviteMembers')}</AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground">{t('hosts.inviteDesc')}</AlertDescription>
              </Alert>
            </div>
          )}

          <div className="px-3 pt-1 pb-2">
            <p className="text-xs text-muted-foreground">
              {t('hosts.count', { count: filteredHosts.length })}
            </p>
          </div>

          {loading ? (
            <HostListSkeleton count={8} />
          ) : filteredHosts.length === 0 ? (
            <EmptyState
              icon={<Server className="size-12" />}
              title={t('hosts.noHosts')}
              description={searchQuery ? t('hosts.tryDifferentSearch') : t('hosts.addFirstHost')}
              action={
                !searchQuery && (
                  <Button size="sm" onClick={() => setHostDialogOpen(true)}>
                    <Plus className="size-4 mr-1" data-icon="inline-start" />
                    {t('hosts.addHost')}
                  </Button>
                )
              }
            />
          ) : (
            <div className="flex flex-col gap-2 px-3 pb-3">
              {filteredHosts.map((host, index) => (
                <div
                  key={host.id}
                  className="slide-in-from-bottom fade-in"
                  style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
                >
                  <MobileHostCard
                    host={host}
                    onConnect={handleConnect}
                    onShare={isTeamEnabled && currentTeam ? handleShareHostClick : undefined}
                  />
                </div>
              ))}
            </div>
          )}
        </ViewContent>

        <FAB onClick={() => setHostDialogOpen(true)} title={t('hosts.addHost')} />

        <MobileToolbarSheet
          open={mobileToolbarOpen}
          onOpenChange={setMobileToolbarOpen}
          onNewHost={() => setHostDialogOpen(true)}
          onNewLocalTerminal={handleNewLocalTerminal}
          onSerialConnect={() => setSerialDialogOpen(true)}
        />

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
          hostName={decryptingHost ? ((decryptingHost.hostData as Record<string, unknown>).name as string) : ''}
          password={decryptPassword}
          onPasswordChange={setDecryptPassword}
          onDecrypt={handleDecryptAndImport}
        />
      </ViewContainer>
    )
  }

  return (
    <ViewContainer>
      <div className="shrink-0 border-b border-border/60 bg-background px-4 py-3 flex flex-col gap-3 slide-in-from-top fade-in">
        <div className="flex items-stretch gap-2 w-full">
          <Input
            placeholder={t('hosts.search')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="h-10 flex-1 rounded-lg bg-secondary/40 border-border/60"
          />
          <Button className="h-10 px-6 shrink-0 rounded-lg" onClick={() => handleConnectBarSubmit(searchQuery)}>
            {t('hosts.connect')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="gap-1 rounded-md h-9">
                {t('hosts.newHost')}
                <ChevronDown className="size-4 opacity-70" data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setHostDialogOpen(true)}>
                <Server className="size-4" data-icon="inline-start" />
                {t('hosts.sshHost')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled>{t('hosts.importFromFile')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" className="h-9 rounded-md" onClick={handleNewLocalTerminal}>
            <Terminal className="size-4" data-icon="inline-start" />
            {t('hosts.terminal')}
          </Button>

          <Button variant="outline" size="sm" className="h-9 rounded-md" onClick={() => setSerialDialogOpen(true)}>
            <Usb className="size-4" data-icon="inline-start" />
            {t('hosts.serial')}
          </Button>

          <div className="flex-1" />

          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className={cn('size-9 rounded-md', gridView && 'bg-secondary/80')}
              title={t('hosts.grid')}
              onClick={() => setGridView(true)}
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn('size-9 rounded-md', !gridView && 'bg-secondary/80')}
              title={t('hosts.list')}
              onClick={() => setGridView(false)}
            >
              <List className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <ViewContent className="p-6 flex flex-col gap-4 min-h-0">
        <TeamSharedSection
          sharedHosts={sharedHosts}
          sharedSnippets={sharedSnippets}
          isTeamEnabled={isTeamEnabled}
          currentTeamId={currentTeam?.id}
          onImportSharedHost={handleImportSharedHost}
          onImportSharedSnippet={handleImportSharedSnippet}
        />

        {!isTeamEnabled && (
          <Alert className="border-border/60 bg-secondary/20 py-3">
            <AlertTitle className="text-sm font-medium">{t('hosts.inviteMembers')}</AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">{t('hosts.inviteDesc')}</AlertDescription>
          </Alert>
        )}

        <ViewHeader
          title={t('hosts.title')}
          description={t('hosts.count', { count: filteredHosts.length })}
          className="slide-in-from-bottom fade-in"
        />

        {filteredHosts.length === 0 && !loading ? (
          <EmptyState
            icon={<Server className="size-12" />}
            title={t('hosts.noHosts')}
            description={searchQuery ? t('hosts.tryDifferentSearch') : t('hosts.addFirstHost')}
            action={
              !searchQuery && (
                <Button onClick={() => setHostDialogOpen(true)}>
                  <Plus className="size-4 mr-1" data-icon="inline-start" />
                  {t('hosts.addHost')}
                </Button>
              )
            }
          />
        ) : (
          <HostListView
            hosts={filteredHosts}
            searchQuery={searchQuery}
            loading={loading}
            gridView={gridView}
            setGridView={setGridView}
            handleConnect={handleConnect}
            handleShareHostClick={handleShareHostClick}
            isTeamEnabled={isTeamEnabled}
            currentTeamId={currentTeam?.id}
          />
        )}
      </ViewContent>

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
        hostName={decryptingHost ? ((decryptingHost.hostData as Record<string, unknown>).name as string) : ''}
        password={decryptPassword}
        onPasswordChange={setDecryptPassword}
        onDecrypt={handleDecryptAndImport}
      />
    </ViewContainer>
  )
}

export default HostsView
