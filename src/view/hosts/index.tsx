import type { SnippetRecord } from '@/service/database'
import type { SerialConfig } from '@/service/serial'
import type { Host } from '@/types'
import type { EncryptedData } from '@/utils/team-encryption'
import {
  CalendarDays,
  ChevronDown,
  Code,
  Download,
  LayoutGrid,
  List,
  Lock,
  MoreHorizontal,
  Plus,
  Server,
  Star,
  Tag,
  Terminal,
  Trash2,
  Usb,
  UserPlus,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import MobileHostCard from './mobile-host-card'
import { HostDialog } from '@/components/host-list/host-dialog'
import SerialDialog from '@/components/serial-dialog'
import { ShareHostDialog } from '@/components/share-host-dialog'
import FAB from '@/components/ui/fab'
import { HostCardSkeleton, HostListSkeleton } from '@/components/ui/view-skeletons'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet'
import { toast } from '@/components/ui/sonner'
import {
  EmptyState,
  ViewContainer,
  ViewContent,
  ViewHeader,
} from '@/components/view-container'
import { useIsMobile } from '@/hooks/use-breakpoint'
import { cn } from '@/lib/utils'
import { createSnippet } from '@/service/database'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { useCurrentTeam, useIsTeamEnabled, useTeamStore } from '@/store/team'
import { decryptWithPassword, isEncryptedData } from '@/utils/team-encryption'

const HostsView: React.FC = () => {
  const { t } = useTranslation()
  const app = useAppStore()
  const hostStore = useHostStore()
  const hosts = useHostStore(s => s.hosts)
  const navigate = useNavigate()
  const isTeamEnabled = useIsTeamEnabled()
  const currentTeam = useCurrentTeam()
  const sharedHosts = useTeamStore(s => s.sharedHosts)
  const sharedSnippets = useTeamStore(s => s.sharedSnippets)
  const isMobile = useIsMobile()

  // Dialog states
  const [hostDialogOpen, setHostDialogOpen] = useState(false)
  const [serialDialogOpen, setSerialDialogOpen] = useState(false)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [shareDialogHost, setShareDialogHost] = useState<Host | null>(null)
  const [decryptDialogOpen, setDecryptDialogOpen] = useState(false)
  const [decryptPassword, setDecryptPassword] = useState('')
  const [decryptingHost, setDecryptingHost] = useState<
    (typeof sharedHosts)[0] | null
  >(null)

  // Mobile toolbar sheet state
  const [mobileToolbarOpen, setMobileToolbarOpen] = useState(false)

  // Loading state
  const [loading, setLoading] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [gridView, setGridView] = useState(true)

  // Load hosts and groups on mount - only depend on stable values
  useEffect(() => {
    setLoading(true)
    void hostStore.loadHosts().finally(() => setLoading(false))
    void hostStore.loadGroups()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load shared data when team is enabled - only depend on stable values
  useEffect(() => {
    if (isTeamEnabled && currentTeam) {
      void useTeamStore.getState().loadSharedHosts(currentTeam.id)
      void useTeamStore.getState().loadSharedSnippets(currentTeam.id)
    }
  }, [isTeamEnabled, currentTeam])

  const handleImportSharedSnippet = async (
    sharedSnippet: (typeof sharedSnippets)[0],
  ) => {
    const snippetData = sharedSnippet.snippetData as {
      id?: string
      name: string
      description?: string
      script: string
      package_id?: string
      tags?: string
      variables?: string
    }

    const newSnippet: SnippetRecord = {
      id: crypto.randomUUID(),
      name: snippetData.name,
      description: snippetData.description,
      script: snippetData.script,
      package_id: snippetData.package_id,
      tags: snippetData.tags,
      variables: snippetData.variables,
    }

    try {
      await createSnippet(newSnippet)
      toast.success(t('teams.importSuccess'), {
        description: snippetData.name,
      })
    } catch (error) {
      toast.error(String(error))
    }
  }

  const handleImportSharedHost = async (
    sharedHost: (typeof sharedHosts)[0],
  ) => {
    const hostData = sharedHost.hostData as Record<string, unknown>

    // Check if data is encrypted
    const isEncrypted = hostData._encrypted === true

    if (isEncrypted) {
      // Show decrypt dialog
      setDecryptingHost(sharedHost)
      setDecryptPassword('')
      setDecryptDialogOpen(true)
      return
    }

    // Direct import without decryption
    await importHostData(hostData)
  }

  const importHostData = async (hostData: Record<string, unknown>) => {
    const newHost: Host = {
      id: crypto.randomUUID(),
      name: hostData.name as string,
      hostname: hostData.hostname as string,
      port: (hostData.port as number) || 22,
      username: hostData.username as string,
      authType: (hostData.auth_type as Host['authType']) || 'password',
      password: hostData.password as string | undefined,
      privateKey: hostData.private_key as string | undefined,
      groupId: hostData.group_id as string | undefined,
      isFavorite: Boolean(hostData.is_favorite),
      color: hostData.color as string | undefined,
      portForwards: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await hostStore.addHost(newHost)
    toast.success(t('teams.importSuccess'), {
      description: newHost.name,
    })
  }

  const handleDecryptAndImport = async () => {
    if (!decryptingHost || !decryptPassword) return

    try {
      const hostData = { ...decryptingHost.hostData } as Record<string, unknown>

      // Decrypt password if encrypted
      if (
        hostData.password_encrypted &&
        isEncryptedData(hostData.password_encrypted)
      ) {
        hostData.password = await decryptWithPassword(
          hostData.password_encrypted as EncryptedData,
          decryptPassword,
        )
        delete hostData.password_encrypted
      }

      // Decrypt private key if encrypted
      if (
        hostData.private_key_encrypted &&
        isEncryptedData(hostData.private_key_encrypted)
      ) {
        hostData.private_key = await decryptWithPassword(
          hostData.private_key_encrypted as EncryptedData,
          decryptPassword,
        )
        delete hostData.private_key_encrypted
      }

      delete hostData._encrypted

      await importHostData(hostData)
      setDecryptDialogOpen(false)
      setDecryptPassword('')
      setDecryptingHost(null)
    } catch {
      toast.error(t('teams.decryptFailed'))
    }
  }

  const handleShareHostClick = (host: Host) => {
    setShareDialogHost(host)
    setShareDialogOpen(true)
  }

  const handleShareHost = async (
    hostData: Record<string, unknown>,
    permission: 'readonly' | 'readwrite',
  ) => {
    if (!currentTeam) return
    await useTeamStore
      .getState()
      .shareHost(currentTeam.id, hostData, permission)
  }

  const handleConnect = useCallback(
    (host: Host) => {
      const newTab = app.addTab({
        label: host.name,
        type: 'remote',
        hostId: host.id,
      })
      navigate(`/terminal?tab=${newTab.id}`)
    },
    [app, navigate],
  )

  const handleNewLocalTerminal = () => {
    const newTab = app.addTab({
      label: 'Local',
      type: 'local',
    })
    navigate(`/terminal?tab=${newTab.id}`)
  }

  const handleConnectBarSubmit = useCallback(() => {
    const q = searchQuery.trim()
    if (!q) {
      toast.info(t('toast.enterHost'))
      return
    }
    const lower = q.toLowerCase()
    const match = hosts.find(
      h =>
        h.name.toLowerCase().includes(lower) ||
        h.hostname.toLowerCase().includes(lower) ||
        `${h.username}@${h.hostname}`
          .toLowerCase()
          .includes(lower.replace(/^ssh\s+/i, '')),
    )
    if (match) {
      handleConnect(match)
      return
    }
    toast.info(t('toast.noMatchedHost'), {
      description: t('toast.useNewHost'),
    })
  }, [searchQuery, hosts, handleConnect, t])

  const handleConnectSerial = (config: SerialConfig, sessionId: string) => {
    const portName = config.name.split('/').pop() || config.name
    const newTab = app.addTab({
      label: `Serial (${portName})`,
      type: 'serial',
      serialSessionId: sessionId,
      serialConfig: {
        port: config.name,
        baudRate: config.baudRate,
      },
    })
    navigate(`/terminal?tab=${newTab.id}`)
    setSerialDialogOpen(false)
  }

  const filteredHosts = hosts.filter(
    host =>
      host.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      host.hostname.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  // Mobile sheet for toolbar actions (replaces toolbar on mobile)
  const renderMobileToolbarSheet = () => (
    <Sheet open={mobileToolbarOpen} onOpenChange={setMobileToolbarOpen}>
      <SheetContent side="bottom" className="h-auto max-h-[70dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
        <div className="flex flex-col gap-1 pt-2">
          <p className="px-2 pb-3 text-sm font-semibold text-muted-foreground">
            Actions
          </p>
          <button
            className="flex items-center gap-3 w-full px-3 py-3.5 rounded-lg text-foreground hover:bg-accent active:scale-[0.98] transition-colors"
            onClick={() => { setHostDialogOpen(true); setMobileToolbarOpen(false) }}
          >
            <Server className="size-5 text-primary" />
            <span className="text-sm font-medium">{t('hosts.newHost')}</span>
          </button>
          <button
            className="flex items-center gap-3 w-full px-3 py-3.5 rounded-lg text-foreground hover:bg-accent active:scale-[0.98] transition-colors"
            onClick={() => { handleNewLocalTerminal(); setMobileToolbarOpen(false) }}
          >
            <Terminal className="size-5 text-muted-foreground" />
            <span className="text-sm">Local Terminal</span>
          </button>
          <button
            className="flex items-center gap-3 w-full px-3 py-3.5 rounded-lg text-foreground hover:bg-accent active:scale-[0.98] transition-colors"
            onClick={() => { setSerialDialogOpen(true); setMobileToolbarOpen(false) }}
          >
            <Usb className="size-5 text-muted-foreground" />
            <span className="text-sm">Serial Connection</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )

  // ─── Mobile layout ───────────────────────────────────────────────
  if (isMobile) {
    return (
      <ViewContainer>
        {/* Mobile: compact search bar only */}
        <div className="shrink-0 border-b border-border/60 bg-background px-3 py-2.5 flex flex-col gap-2">
          <Input
            placeholder={t('hosts.search')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="h-10 w-full rounded-lg bg-secondary/40 border-border/60"
          />
          {/* Quick action row */}
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
              onClick={() => { const q = searchQuery.trim(); if (q) handleConnectBarSubmit() }}
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
          {/* Team Shared Section */}
          {isTeamEnabled && currentTeam && (sharedHosts.length > 0 || sharedSnippets.length > 0) && (
            <div className="px-3 pt-3 space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Server className="size-4" />
                {t('teams.sharedHosts')}
                <span className="text-muted-foreground">({sharedHosts.length})</span>
              </h3>
              <div className="flex flex-col gap-2">
                {sharedHosts.slice(0, 3).map(sharedHost => {
                  const hostData = sharedHost.hostData as Record<string, unknown>
                  return (
                    <button
                      key={sharedHost.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 text-left active:scale-[0.98] transition-transform"
                      onClick={() => handleImportSharedHost(sharedHost)}
                    >
                      <Download className="size-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{(hostData.name as string) || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground truncate">{hostData.username as string}@{hostData.hostname as string}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {!isTeamEnabled && (
            <div className="px-3 pt-3">
              <Alert className="border-border/60 bg-secondary/20 py-3">
                <Users className="size-4" />
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

        {/* FAB — New Host */}
        <FAB onClick={() => setHostDialogOpen(true)} title={t('hosts.addHost')} />

        {renderMobileToolbarSheet()}

        <HostDialog open={hostDialogOpen} onClose={() => setHostDialogOpen(false)} />

        <SerialDialog
          open={serialDialogOpen}
          onClose={() => setSerialDialogOpen(false)}
          onConnect={handleConnectSerial}
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

  // ─── Desktop layout ──────────────────────────────────────────────
  return (
    <ViewContainer>
      {/* Desktop toolbar */}
      <div className="shrink-0 border-b border-border/60 bg-background px-4 py-3 flex flex-col gap-3 slide-in-from-top fade-in">
        <div className="flex items-stretch gap-2 w-full">
          <Input
            placeholder={t('hosts.search')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="h-10 flex-1 rounded-lg bg-secondary/40 border-border/60"
          />
          <Button className="h-10 px-6 shrink-0 rounded-lg" onClick={handleConnectBarSubmit}>
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
              variant="ghost" size="icon"
              className={cn('size-9 rounded-md', gridView && 'bg-secondary/80')}
              title={t('hosts.grid')} onClick={() => setGridView(true)}>
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className={cn('size-9 rounded-md', !gridView && 'bg-secondary/80')}
              title={t('hosts.list')} onClick={() => setGridView(false)}>
              <List className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-9 rounded-md" title={t('hosts.tags')}>
              <Tag className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-9 rounded-md" title={t('hosts.calendar')}>
              <CalendarDays className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-9 rounded-md" title={t('hosts.invite')}>
              <UserPlus className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <ViewContent className="p-6 flex flex-col gap-4 min-h-0">
        {/* Team Shared Section */}
        {isTeamEnabled && currentTeam && (sharedHosts.length > 0 || sharedSnippets.length > 0) && (
          <div className="space-y-4">
            {sharedHosts.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <Server className="size-4" />
                    {t('teams.sharedHosts')}
                    <span className="text-muted-foreground">({sharedHosts.length})</span>
                  </h3>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => navigate('/teams')}>
                    {t('common.settings')}
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {sharedHosts.slice(0, 3).map(sharedHost => {
                    const hostData = sharedHost.hostData as Record<string, unknown>
                    const isEncrypted = hostData._encrypted === true
                    return (
                      <button
                        type="button"
                        key={sharedHost.id}
                        className="text-left p-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all duration-200"
                        onClick={() => handleImportSharedHost(sharedHost)}
                      >
                        <div className="flex items-start gap-2">
                          <Server className="size-4 mt-0.5 text-primary" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate flex items-center gap-1">
                              {(hostData.name as string) || 'Unknown'}
                              {isEncrypted && <Lock className="size-3 text-amber-500" />}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {hostData.username as string}@{hostData.hostname as string}:{hostData.port as number || 22}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                                {sharedHost.permission === 'readonly' ? t('teams.readonly') : t('teams.readwrite')}
                              </span>
                              {isEncrypted && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500">{t('teams.encrypted')}</span>}
                            </div>
                          </div>
                          <Download className="size-4 text-muted-foreground shrink-0" />
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {sharedSnippets.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <Code className="size-4" />
                    {t('teams.sharedSnippets')}
                    <span className="text-muted-foreground">({sharedSnippets.length})</span>
                  </h3>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => navigate('/teams')}>
                    {t('common.settings')}
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {sharedSnippets.slice(0, 3).map(sharedSnippet => {
                    const snippetData = sharedSnippet.snippetData as { name?: string; description?: string; script?: string }
                    return (
                      <button
                        type="button"
                        key={sharedSnippet.id}
                        className="text-left p-3 rounded-lg border border-dashed border-secondary/50 bg-secondary/5 hover:bg-secondary/10 hover:border-secondary/70 transition-all duration-200"
                        onClick={() => handleImportSharedSnippet(sharedSnippet)}
                      >
                        <div className="flex items-start gap-2">
                          <Code className="size-4 mt-0.5 text-secondary" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{snippetData.name || 'Unknown'}</div>
                            {snippetData.description && <div className="text-xs text-muted-foreground truncate">{snippetData.description}</div>}
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/20 text-secondary">
                                {sharedSnippet.permission === 'readonly' ? t('teams.readonly') : t('teams.readwrite')}
                              </span>
                            </div>
                          </div>
                          <Download className="size-4 text-muted-foreground shrink-0" />
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {!isTeamEnabled && (
          <Alert className="border-border/60 bg-secondary/20 py-3">
            <Users className="size-4" />
            <AlertTitle className="text-sm font-medium">{t('hosts.inviteMembers')}</AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">{t('hosts.inviteDesc')}</AlertDescription>
          </Alert>
        )}

        <ViewHeader
          title={t('hosts.title')}
          description={t('hosts.count', { count: filteredHosts.length })}
          className="slide-in-from-bottom fade-in"
        />

        {loading ? (
          <HostCardSkeleton count={6} />
        ) : filteredHosts.length === 0 ? (
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
        ) : gridView ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredHosts.map((host, index) => (
              <div key={host.id} className="relative group">
                <button
                  type="button"
                  className="text-left w-full p-4 rounded-xl border border-border/50 bg-card/80 hover:bg-accent/40 hover:border-primary/30 hover:shadow-md hover:shadow-primary/5 cursor-pointer transition-all duration-200 hover-lift slide-in-from-bottom fade-in"
                  style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
                  onClick={() => handleConnect(host)}
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-lg bg-secondary/80">
                      <Server className="size-6" style={{ color: host.color || '#888' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium truncate">{host.name}</h3>
                        {host.isFavorite && <Star className="size-4 fill-yellow-500 text-yellow-500 shrink-0" />}
                      </div>
                      <p className="text-sm text-muted-foreground truncate mt-0.5">{t('hosts.sshAuth', { username: host.username })}</p>
                      <p className="text-xs text-muted-foreground/80 truncate mt-1">{host.username}@{host.hostname}:{host.port}</p>
                    </div>
                  </div>
                </button>
                {isTeamEnabled && currentTeam && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="absolute top-2 right-2 size-7 opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleShareHostClick(host)}>
                        <Users className="size-4 mr-2" data-icon="inline-start" />
                        {t('teams.shareHost')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => { void hostStore.deleteHost(host.id); toast.success(t('common.delete')) }} className="text-destructive">
                        <Trash2 className="size-4 mr-2" data-icon="inline-start" />
                        {t('common.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredHosts.map((host, index) => (
              <button
                type="button"
                key={host.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card/80 hover:bg-accent/40 hover:border-primary/30 hover:shadow-sm text-left transition-all duration-200 hover-lift slide-in-from-right fade-in"
                style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
                onClick={() => handleConnect(host)}
              >
                <Server className="size-5 shrink-0" style={{ color: host.color || '#888' }} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{host.name}</div>
                  <div className="text-sm text-muted-foreground truncate">{t('hosts.sshAuth', { username: host.username })} · {host.hostname}</div>
                </div>
                {host.isFavorite && <Star className="size-4 fill-yellow-500 text-yellow-500 shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </ViewContent>

      <HostDialog open={hostDialogOpen} onClose={() => setHostDialogOpen(false)} />

      <SerialDialog
        open={serialDialogOpen}
        onClose={() => setSerialDialogOpen(false)}
        onConnect={handleConnectSerial}
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

// Decrypt Password Dialog Component
interface DecryptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  hostName: string
  password: string
  onPasswordChange: (password: string) => void
  onDecrypt: () => void
}

function DecryptDialog({
  open,
  onOpenChange,
  hostName,
  password,
  onPasswordChange,
  onDecrypt,
}: DecryptDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="size-5" />
            {t('teams.enterDecryptPassword')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            {t('teams.decryptDesc', { host: hostName })}
          </p>

          <div className="space-y-2">
            <Label htmlFor="decrypt-password">
              {t('teams.decryptPassword')}
            </Label>
            <Input
              id="decrypt-password"
              type="password"
              value={password}
              onChange={e => onPasswordChange(e.target.value)}
              placeholder={t('teams.enterDecryptPassword')}
              onKeyDown={e => {
                if (e.key === 'Enter' && password) onDecrypt()
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onDecrypt} disabled={!password}>
            {t('teams.decrypt')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default HostsView
