import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import {
  Clock,
  Copy,
  Download,
  Link2,
  LogIn,
  Mail,
  MoreHorizontal,
  Package,
  Plus,
  RefreshCw,
  Settings,
  Shield,
  Trash2,
  Upload,
  User,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ViewContainer,
  ViewContent,
  ViewToolbar,
} from '@/components/view-container'
import {
  exportTeamPackage,
  importTeamPackage,
  previewTeamPackage,
} from '@/service/sync'
import {
  useCurrentTeam,
  useIsTeamEnabled,
  useTeams,
  useTeamStore,
  useUserId,
} from '@/store/team'

// ============================================================================
// Create Team Dialog
// ============================================================================

interface CreateTeamDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const CreateTeamDialog: React.FC<CreateTeamDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'local' | 'cloud'>('local')
  const [endpoint, setEndpoint] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [loading, setLoading] = useState(false)

  const createTeam = useTeamStore(state => state.createTeam)
  const updateTeam = useTeamStore(state => state.updateTeam)
  const enableTeamMode = useTeamStore(state => state.enableTeamMode)

  const handleCreate = async () => {
    if (!name.trim()) return

    setLoading(true)
    try {
      await createTeam(name.trim(), mode)

      // If cloud mode, update team with endpoint and token
      if (mode === 'cloud' && endpoint) {
        // The team was just created with the name, we need to get it from store
        const teams = useTeamStore.getState().teams
        const createdTeam = teams.find(t => t.name === name.trim())
        if (createdTeam) {
          await updateTeam(createdTeam.id, {
            mode: 'cloud',
            endpoint,
            apiToken,
          })
        }
      }

      await enableTeamMode({ mode, endpoint, apiToken })
      toast.success(t('teams.teamCreated'))
      onOpenChange(false)
      setName('')
      setMode('local')
      setEndpoint('')
      setApiToken('')
    } catch (error) {
      toast.error(String(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t('teams.createTeam')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="team-name">{t('teams.teamName')}</Label>
            <Input
              id="team-name"
              placeholder={t('teams.teamName')}
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>{t('teams.connectionMode')}</Label>
            <div className="space-y-2">
              <button
                type="button"
                className={`flex items-start gap-3 w-full p-3 border rounded-lg cursor-pointer transition-colors ${
                  mode === 'local'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
                onClick={() => setMode('local')}
              >
                <Package
                  className={`mt-0.5 ${mode === 'local' ? 'text-primary' : 'text-muted-foreground'}`}
                />
                <div className="text-left">
                  <div className="font-medium">{t('teams.localMode')}</div>
                  <div className="text-sm text-muted-foreground">
                    {t('teams.localModeDesc')}
                  </div>
                </div>
              </button>
              <button
                type="button"
                className={`flex items-start gap-3 w-full p-3 border rounded-lg cursor-pointer transition-colors ${
                  mode === 'cloud'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
                onClick={() => setMode('cloud')}
              >
                <Wifi
                  className={`mt-0.5 ${mode === 'cloud' ? 'text-primary' : 'text-muted-foreground'}`}
                />
                <div className="text-left">
                  <div className="font-medium">{t('teams.cloudMode')}</div>
                  <div className="text-sm text-muted-foreground">
                    {t('teams.cloudModeDesc')}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {mode === 'cloud' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="endpoint">{t('teams.serverEndpoint')}</Label>
                <Input
                  id="endpoint"
                  placeholder="https://team.example.com"
                  value={endpoint}
                  onChange={e => setEndpoint(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="api-token">{t('teams.apiToken')}</Label>
                <Input
                  id="api-token"
                  type="password"
                  placeholder="••••••••"
                  value={apiToken}
                  onChange={e => setApiToken(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || loading}>
            {loading ? t('common.loading') : t('teams.createTeam')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Join Team Dialog (Import Team Package)
// ============================================================================

interface JoinTeamDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const JoinTeamDialog: React.FC<JoinTeamDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { t } = useTranslation()
  const [step, setStep] = useState<'select' | 'preview' | 'importing'>('select')
  const [previewData, setPreviewData] = useState<{
    teamName: string
    hosts: number
    groups: number
    snippets: number
    members: number
  } | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enableTeamMode = useTeamStore(state => state.enableTeamMode)

  useEffect(() => {
    if (!open) {
      setStep('select')
      setPreviewData(null)
      setContent(null)
      setError(null)
      setLoading(false)
    }
  }, [open])

  const handleSelectFile = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          { name: 'Team Package', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })

      if (selected) {
        const fileContent = await readTextFile(selected)
        const preview = previewTeamPackage(fileContent)

        if (preview) {
          setContent(fileContent)
          setPreviewData({
            teamName: preview.teamName,
            hosts: preview.hosts?.length || 0,
            groups: preview.groups?.length || 0,
            snippets: preview.snippets?.length || 0,
            members: preview.members?.length || 0,
          })
          setStep('preview')
        } else {
          setError(t('teams.invalidPackageFormat'))
        }
      }
    } catch (err) {
      setError(String(err))
    }
  }

  const handleImport = async () => {
    if (!content) return

    setStep('importing')
    setLoading(true)
    try {
      const stats = await importTeamPackage(content, 'merge')
      await enableTeamMode({ mode: 'local' })
      toast.success(t('teams.importSuccess'), {
        description: `${stats.hosts} hosts, ${stats.snippets} snippets imported`,
      })
      onOpenChange(false)
    } catch (err) {
      setError(String(err))
      setStep('preview')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('teams.joinTeam')}</DialogTitle>
        </DialogHeader>

        {step === 'select' && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              {t('teams.joinTeamDesc')}
            </p>
            {error && (
              <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg">
                {error}
              </div>
            )}
            <Button onClick={handleSelectFile} className="w-full">
              <Upload className="size-4 mr-2" />
              {t('teams.selectPackageFile')}
            </Button>
          </div>
        )}

        {step === 'preview' && previewData && (
          <div className="space-y-4 py-4">
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <div className="font-medium flex items-center gap-2">
                <Package className="size-4" />
                {previewData.teamName}
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                {previewData.hosts > 0 && (
                  <div>•{previewData.hosts} host(s)</div>
                )}
                {previewData.groups > 0 && (
                  <div>•{previewData.groups} group(s)</div>
                )}
                {previewData.snippets > 0 && (
                  <div>•{previewData.snippets} snippet(s)</div>
                )}
                {previewData.members > 0 && (
                  <div>•{previewData.members} member(s)</div>
                )}
              </div>
            </div>
            {error && (
              <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg">
                {error}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('select')}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleImport}>
                <Download className="size-4 mr-2" />
                {t('teams.import')}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'importing' && (
          <div className="py-8 text-center space-y-3">
            <RefreshCw className="size-8 mx-auto animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {t('teams.importing')}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Invite Dialog
// ============================================================================

interface InviteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamId: string
}

const InviteDialog: React.FC<InviteDialogProps> = ({
  open,
  onOpenChange,
  teamId,
}) => {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'link' | 'code' | 'email'>('link')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [invite, setInvite] = useState<{
    code?: string
    linkToken?: string
  } | null>(null)
  const [loading, setLoading] = useState(false)

  const createInvite = useTeamStore(state => state.createInvite)
  const teams = useTeams()
  const team = teams.find(t => t.id === teamId)

  useEffect(() => {
    if (!open) {
      setInvite(null)
      setEmail('')
      setTab('link')
    }
  }, [open])

  const handleCreate = async () => {
    setLoading(true)
    try {
      const result = await createInvite(
        teamId,
        tab,
        tab === 'email' ? email : undefined,
        role,
      )
      setInvite(result)
    } catch (error) {
      toast.error(String(error))
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success(t('teams.copied'))
  }

  const inviteLink = invite?.linkToken
    ? `${team?.endpoint || ''}/invite/${invite.linkToken}`
    : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t('teams.inviteMember')}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="link" className="gap-1">
              <Link2 className="size-4" />
              {t('teams.inviteLink')}
            </TabsTrigger>
            <TabsTrigger value="code" className="gap-1">
              <Copy className="size-4" />
              {t('teams.inviteCode')}
            </TabsTrigger>
            <TabsTrigger value="email" className="gap-1">
              <Mail className="size-4" />
              {t('teams.inviteEmail')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="link" className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              {t('teams.inviteLinkDesc')}
            </p>
            <div className="space-y-2">
              <Label>{t('teams.role')}</Label>
              <Select
                value={role}
                onValueChange={v => setRole(v as typeof role)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t('teams.admin')}</SelectItem>
                  <SelectItem value="member">{t('teams.member')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {invite?.linkToken ? (
              <div className="space-y-2">
                <Label>{t('teams.inviteLink')}</Label>
                <div className="flex gap-2">
                  <Input
                    value={inviteLink}
                    readOnly
                    className="font-mono text-sm"
                  />
                  <Button size="icon" onClick={() => handleCopy(inviteLink)}>
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                onClick={handleCreate}
                disabled={loading}
                className="w-full"
              >
                {loading ? t('common.loading') : t('teams.generate')}
              </Button>
            )}
          </TabsContent>

          <TabsContent value="code" className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              {t('teams.inviteCodeDesc')}
            </p>
            <div className="space-y-2">
              <Label>{t('teams.role')}</Label>
              <Select
                value={role}
                onValueChange={v => setRole(v as typeof role)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t('teams.admin')}</SelectItem>
                  <SelectItem value="member">{t('teams.member')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {invite?.code ? (
              <div className="space-y-2">
                <Label>{t('teams.inviteCode')}</Label>
                <div className="flex gap-2">
                  <Input
                    value={invite.code}
                    readOnly
                    className="font-mono text-lg font-bold text-center tracking-widest"
                  />
                  <Button
                    size="icon"
                    onClick={() => handleCopy(invite.code || '')}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                onClick={handleCreate}
                disabled={loading}
                className="w-full"
              >
                {loading ? t('common.loading') : t('teams.generate')}
              </Button>
            )}
          </TabsContent>

          <TabsContent value="email" className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              {t('teams.inviteEmailDesc')}
            </p>
            <div className="space-y-2">
              <Label htmlFor="invite-email">{t('teams.emailAddress')}</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('teams.role')}</Label>
              <Select
                value={role}
                onValueChange={v => setRole(v as typeof role)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t('teams.admin')}</SelectItem>
                  <SelectItem value="member">{t('teams.member')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleCreate}
              disabled={loading || !email.trim()}
              className="w-full"
            >
              {loading ? t('common.loading') : t('teams.sendInvite')}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Export Dialog
// ============================================================================

interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamId: string
  teamName: string
}

const ExportDialog: React.FC<ExportDialogProps> = ({
  open,
  onOpenChange,
  teamId,
  teamName,
}) => {
  const { t } = useTranslation()
  const [includeHosts, setIncludeHosts] = useState(true)
  const [includeSnippets, setIncludeSnippets] = useState(true)
  const [includeMembers, setIncludeMembers] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleExport = async () => {
    setLoading(true)
    try {
      const filePath = await exportTeamPackage({
        teamId,
        teamName,
        includeHosts,
        includeSnippets,
        includeMembers,
      })
      if (filePath) {
        toast.success(t('teams.exportSuccess'), {
          description: filePath,
        })
        onOpenChange(false)
      }
    } catch (error) {
      toast.error(String(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('teams.exportTeamPackage')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            {t('teams.exportTeamDesc')}
          </p>

          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeHosts}
                onChange={e => setIncludeHosts(e.target.checked)}
                className="size-4"
              />
              <div>
                <div className="text-sm font-medium">
                  {t('teams.includeHosts')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('teams.includeHostsDesc')}
                </div>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeSnippets}
                onChange={e => setIncludeSnippets(e.target.checked)}
                className="size-4"
              />
              <div>
                <div className="text-sm font-medium">
                  {t('teams.includeSnippets')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('teams.includeSnippetsDesc')}
                </div>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeMembers}
                onChange={e => setIncludeMembers(e.target.checked)}
                className="size-4"
              />
              <div>
                <div className="text-sm font-medium">
                  {t('teams.includeMembers')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('teams.includeMembersDesc')}
                </div>
              </div>
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleExport}
            disabled={loading || (!includeHosts && !includeSnippets)}
          >
            {loading ? (
              <RefreshCw className="size-4 mr-2 animate-spin" />
            ) : (
              <Download className="size-4 mr-2" />
            )}
            {t('teams.export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Team Settings Dialog
// ============================================================================

interface TeamSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamId: string
}

const TeamSettingsDialog: React.FC<TeamSettingsDialogProps> = ({
  open,
  onOpenChange,
  teamId,
}) => {
  const { t } = useTranslation()
  const teams = useTeams()
  const team = teams.find(t => t.id === teamId)

  const updateTeam = useTeamStore(state => state.updateTeam)
  const deleteTeam = useTeamStore(state => state.deleteTeam)
  const disableTeamMode = useTeamStore(state => state.disableTeamMode)

  const [name, setName] = useState(team?.name || '')
  const [endpoint, setEndpoint] = useState(team?.endpoint || '')
  const [apiToken, setApiToken] = useState(team?.apiToken || '')
  const [autoSync, setAutoSync] = useState(team?.autoSync || false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (team) {
      setName(team.name)
      setEndpoint(team.endpoint || '')
      setApiToken(team.apiToken || '')
      setAutoSync(team.autoSync)
    }
  }, [team])

  const handleSave = async () => {
    setLoading(true)
    try {
      await updateTeam(teamId, {
        name,
        endpoint,
        apiToken,
        autoSync,
      })
      toast.success(t('common.success'))
      onOpenChange(false)
    } catch (error) {
      toast.error(String(error))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (window.confirm(t('teams.deleteTeamConfirm'))) {
      await deleteTeam(teamId)
      toast.success(t('common.success'))
      onOpenChange(false)
    }
  }

  const handleDisableTeamMode = async () => {
    if (window.confirm(t('teams.disableConfirm'))) {
      await disableTeamMode()
      toast.success(t('teams.teamModeDisabled'))
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('teams.teamSettings')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="settings-name">{t('common.name')}</Label>
            <Input
              id="settings-name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          {team?.mode === 'cloud' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="settings-endpoint">
                  {t('teams.serverEndpoint')}
                </Label>
                <Input
                  id="settings-endpoint"
                  value={endpoint}
                  onChange={e => setEndpoint(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-token">{t('teams.apiToken')}</Label>
                <Input
                  id="settings-token"
                  type="password"
                  value={apiToken}
                  onChange={e => setApiToken(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="pt-2 border-t space-y-3">
            <button
              type="button"
              onClick={handleDisableTeamMode}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <WifiOff className="size-4" />
              {t('teams.disableTeamMode')}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="flex items-center gap-2 text-sm text-destructive hover:text-destructive/80 transition-colors"
            >
              <Trash2 className="size-4" />
              {t('teams.deleteTeam')}
            </button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// User Profile Dialog
// ============================================================================

interface UserProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const UserProfileDialog: React.FC<UserProfileDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { t } = useTranslation()
  const userProfile = useTeamStore(state => state.userProfile)
  const updateUserProfile = useTeamStore(state => state.updateUserProfile)
  const [name, setName] = useState(userProfile?.name || '')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (userProfile) {
      setName(userProfile.name)
    }
  }, [userProfile])

  const handleSave = async () => {
    setLoading(true)
    try {
      if (userProfile?.id) {
        await updateUserProfile(userProfile.id, { name })
        toast.success(t('common.success'))
        onOpenChange(false)
      }
    } catch (error) {
      toast.error(String(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t('teams.myProfile')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name">{t('common.name')}</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground/70">ID:</span>
              <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded">
                {userProfile?.id || '—'}
              </code>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={loading || !name.trim()}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Main Teams View
// ============================================================================

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
  const userId = useUserId()

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
  }, [currentTeam, loadMembers, loadSharedHosts, loadSharedSnippets, loadAuditLogs])

  const filteredTeams = teams.filter(team =>
    team.name.toLowerCase().includes(search.toLowerCase()),
  )

  const handleTeamSelect = (teamId: string) => {
    selectTeam(teamId)
  }

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-blue-500/10 text-blue-500 border-blue-500/20'
      default:
        return 'bg-gray-500/10 text-gray-500 border-gray-500/20'
    }
  }

  const isCurrentUserMember = (memberUserId: string) => memberUserId === userId

  const handleSync = async () => {
    await sync()
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

                  {/* Members Tab */}
                  <TabsContent value="members" className="mt-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('common.name')}</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>{t('teams.role')}</TableHead>
                          <TableHead>{t('common.actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {members.map(member => (
                          <TableRow key={member.id}>
                            <TableCell className="font-medium">
                              {member.userName || member.userId.slice(0, 8)}
                              {isCurrentUserMember(member.userId) && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  ({t('teams.you')})
                                </span>
                              )}
                            </TableCell>
                            <TableCell>{member.userEmail || '—'}</TableCell>
                            <TableCell>
                              <Badge className={getRoleBadgeColor(member.role)}>
                                {t(`teams.${member.role}`)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {!isCurrentUserMember(member.userId) ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon">
                                      <MoreHorizontal className="size-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() => {
                                        useTeamStore
                                          .getState()
                                          .updateMemberRole(
                                            member.id,
                                            member.role === 'admin'
                                              ? 'member'
                                              : 'admin',
                                          )
                                      }}
                                    >
                                      <Shield className="size-4 mr-2" />
                                      {member.role === 'admin'
                                        ? t('teams.removeAdmin')
                                        : t('teams.makeAdmin')}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => {
                                        useTeamStore
                                          .getState()
                                          .removeMember(member.id)
                                      }}
                                      className="text-destructive"
                                    >
                                      <Trash2 className="size-4 mr-2" />
                                      {t('teams.removeMember')}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  {member.role === 'admin'
                                    ? t('teams.admin')
                                    : t('teams.member')}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {members.length === 0 && (
                      <p className="text-center py-8 text-muted-foreground text-sm">
                        {t('teams.noMembers')}
                      </p>
                    )}
                  </TabsContent>

                  {/* Shared Hosts Tab */}
                  <TabsContent value="hosts" className="mt-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('common.name')}</TableHead>
                          <TableHead>{t('teams.permissions')}</TableHead>
                          <TableHead>{t('teams.sharedBy')}</TableHead>
                          <TableHead>{t('common.actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sharedHosts.map(share => {
                          const hostData = share.hostData as {
                            name?: string
                          }
                          return (
                            <TableRow key={share.id}>
                              <TableCell className="font-medium">
                                {hostData.name || '—'}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">
                                  {share.permission === 'readonly'
                                    ? t('teams.readonly')
                                    : t('teams.readwrite')}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground text-sm">
                                {share.sharedBy.slice(0, 8)}
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    useTeamStore
                                      .getState()
                                      .unshareHost(share.id)
                                  }}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                    {sharedHosts.length === 0 && (
                      <p className="text-center py-8 text-muted-foreground text-sm">
                        {t('teams.noSharedHosts')}
                      </p>
                    )}
                  </TabsContent>

                  {/* Shared Snippets Tab */}
                  <TabsContent value="snippets" className="mt-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('common.name')}</TableHead>
                          <TableHead>{t('teams.permissions')}</TableHead>
                          <TableHead>{t('teams.sharedBy')}</TableHead>
                          <TableHead>{t('common.actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sharedSnippets.map(share => {
                          const snippetData = share.snippetData as {
                            name?: string
                          }
                          return (
                            <TableRow key={share.id}>
                              <TableCell className="font-medium">
                                {snippetData.name || '—'}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">
                                  {share.permission === 'readonly'
                                    ? t('teams.readonly')
                                    : t('teams.readwrite')}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground text-sm">
                                {share.sharedBy.slice(0, 8)}
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    useTeamStore
                                      .getState()
                                      .unshareSnippet(share.id)
                                  }}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                    {sharedSnippets.length === 0 && (
                      <p className="text-center py-8 text-muted-foreground text-sm">
                        {t('teams.noSharedSnippets')}
                      </p>
                    )}
                  </TabsContent>

                  {/* Audit Logs Tab */}
                  <TabsContent value="audit" className="mt-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('common.name')}</TableHead>
                          <TableHead>Host</TableHead>
                          <TableHead>{t('teams.action')}</TableHead>
                          <TableHead>{t('teams.time')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {auditLogs.map(log => (
                          <TableRow key={log.id}>
                            <TableCell className="font-medium">
                              {log.userName || log.userId.slice(0, 8)}
                            </TableCell>
                            <TableCell>{log.hostName || '—'}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {log.action}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {formatTime(log.createdAt)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {auditLogs.length === 0 && (
                      <p className="text-center py-8 text-muted-foreground text-sm">
                        {t('teams.noAuditLogs')}
                      </p>
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
