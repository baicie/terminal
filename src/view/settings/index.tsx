import type { AppSettings } from '@/service/database'
import type { ExportData } from '@/service/sync'
import {
  AlertCircle,
  Check,
  Download,
  Eye,
  EyeOff,
  HardDrive,
  Loader2,
  Merge,
  Package,
  RefreshCw,
  Replace,
  Server,
  Shield,
  Upload,
  Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ViewContainer,
  ViewContent,
  ViewHeader,
} from '@/components/view-container'
import i18nCore from '@/locales'
import {
  executeQuery,
  getAppSettings,
  saveAppSettings,
  select,
} from '@/service/database'
import { exportDataToFile } from '@/service/sync'
import {
  storageHealthCheck,
  storageInit,
  storageUpload,
} from '@/service/storage'
import { useAppStore } from '@/store/app'
import { useIsTeamEnabled } from '@/store/team'
import { TeamServerConfig } from './team-server-config'

type ImportStep = 'idle' | 'preview' | 'importing' | 'success' | 'error'

interface ImportPreview {
  hosts: number
  groups: number
  snippets: number
  snippetPackages: number
  workspaces: number
}

const SettingsView: React.FC = () => {
  const { t } = useTranslation()
  const app = useAppStore()
  const navigate = useNavigate()
  const isTeamEnabled = useIsTeamEnabled()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)

  // Sync state
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importContent, setImportContent] = useState<string | null>(null)
  const [importStep, setImportStep] = useState<ImportStep>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [showTokenVisible, setShowTokenVisible] = useState(false)

  // Storage state
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'success' | 'error'
  >('idle')
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const loaded = await getAppSettings()
      setSettings(loaded)
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
    setLoading(false)
  }

  const handleSave = async () => {
    if (!settings) return
    try {
      await saveAppSettings(settings)
      app.setTheme(settings.theme)
      app.setLanguage(settings.language)
      await i18nCore.changeLanguage(settings.language)
      loadSettings()
      toast.success(t('settings.saved'))
    } catch (error) {
      console.error('Failed to save settings:', error)
      toast.error(t('settings.saveFailed'))
    }
  }

  const updateSetting = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    if (settings) {
      setSettings({ ...settings, [key]: value })
    }
    if (key === 'theme') {
      app.setTheme(value as AppSettings['theme'])
    }
    if (key === 'language') {
      app.setLanguage(value as string)
      void i18nCore.changeLanguage(value as string)
    }
  }

  // Sync functions
  const resetSyncState = () => {
    setImportStep('idle')
    setImportPreview(null)
    setImportContent(null)
    setErrorMessage(null)
    setImportMode('merge')
  }

  const handleExport = async () => {
    setExporting(true)
    setErrorMessage(null)

    try {
      const filePath = await exportDataToFile()
      if (filePath) {
        setErrorMessage(null)
      }
    } catch (error) {
      console.error('Export failed:', error)
      setErrorMessage(`Export failed: ${error}`)
    } finally {
      setExporting(false)
    }
  }

  // Storage functions
  const handleTestConnection = async () => {
    if (!settings?.syncServiceEndpoint) return

    setTestingConnection(true)
    setConnectionStatus('idle')

    try {
      await storageInit(
        settings.syncServiceType as 'webdav' | 's3' | 'custom',
        settings.syncServiceEndpoint,
        {
          username: settings.syncServiceUsername || undefined,
          password: settings.syncServiceToken || undefined,
        },
      )

      const healthy = await storageHealthCheck()
      if (healthy) {
        setConnectionStatus('success')
      } else {
        setConnectionStatus('error')
      }
    } catch {
      setConnectionStatus('error')
    } finally {
      setTestingConnection(false)
    }
  }

  const handleSyncToServer = async () => {
    if (!settings?.syncServiceEndpoint) return

    setSyncing(true)
    setErrorMessage(null)

    try {
      const exportData = await exportDataToFile()
      if (exportData) {
        const fileContent = '' // 简化处理
        const result = await storageUpload('terminal-backup.json', fileContent)
        if (!result.success) {
          setErrorMessage(result.message)
        }
      }
    } catch (error) {
      console.error('Sync failed:', error)
      setErrorMessage(`Sync failed: ${error}`)
    } finally {
      setSyncing(false)
    }
  }

  const handleSelectImportFile = async () => {
    try {
      // 简化处理
      setImportStep('idle')
    } catch (error) {
      console.error('Failed to read file:', error)
      setErrorMessage(`Failed to read file: ${error}`)
      setImportStep('error')
    }
  }

  const handleImport = async () => {
    if (!importContent) return

    setImportStep('importing')

    try {
      const data: ExportData = JSON.parse(importContent)

      if (data.groups && data.groups.length > 0) {
        for (const group of data.groups as Record<string, unknown>[]) {
          const existing = await select<{ id: string }>(
            'SELECT id FROM groups WHERE id = ?',
            [group.id as string],
          )
          if (existing.length === 0) {
            await executeQuery(
              `INSERT INTO groups (id, name, parent_id, color, inherit_settings, settings, "order") VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                group.id,
                group.name,
                group.parent_id,
                group.color,
                group.inherit_settings,
                group.settings,
                group.order,
              ],
            )
          } else if (importMode === 'replace') {
            await executeQuery(
              `UPDATE groups SET name = ?, parent_id = ?, color = ?, inherit_settings = ?, settings = ?, "order" = ? WHERE id = ?`,
              [
                group.name,
                group.parent_id,
                group.color,
                group.inherit_settings,
                group.settings,
                group.order,
                group.id,
              ],
            )
          }
        }
      }

      if (data.hosts && data.hosts.length > 0) {
        for (const host of data.hosts as Record<string, unknown>[]) {
          const existing = await select<{ id: string }>(
            'SELECT id FROM hosts WHERE id = ?',
            [host.id as string],
          )
          if (existing.length === 0) {
            await executeQuery(
              `INSERT INTO hosts (id, name, hostname, port, username, auth_type, password, private_key, group_id, is_favorite, color, tags, port_forwards, startup_command, environment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                host.id,
                host.name,
                host.hostname,
                host.port,
                host.username,
                host.auth_type,
                host.password,
                host.private_key,
                host.group_id,
                host.is_favorite,
                host.color,
                host.tags,
                host.port_forwards,
                host.startup_command,
                host.environment,
                host.created_at,
                host.updated_at,
              ],
            )
          } else if (importMode === 'replace') {
            await executeQuery(
              `UPDATE hosts SET name = ?, hostname = ?, port = ?, username = ?, auth_type = ?, password = ?, private_key = ?, group_id = ?, is_favorite = ?, color = ?, tags = ?, port_forwards = ?, startup_command = ?, environment = ?, updated_at = ? WHERE id = ?`,
              [
                host.name,
                host.hostname,
                host.port,
                host.username,
                host.auth_type,
                host.password,
                host.private_key,
                host.group_id,
                host.is_favorite,
                host.color,
                host.tags,
                host.port_forwards,
                host.startup_command,
                host.environment,
                Date.now(),
                host.id,
              ],
            )
          }
        }
      }

      if (data.snippets && data.snippets.length > 0) {
        for (const snippet of data.snippets as Record<string, unknown>[]) {
          const existing = await select<{ id: string }>(
            'SELECT id FROM snippets WHERE id = ?',
            [snippet.id as string],
          )
          if (existing.length === 0) {
            await executeQuery(
              `INSERT INTO snippets (id, name, description, script, package_id, tags, variables) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                snippet.id,
                snippet.name,
                snippet.description,
                snippet.script,
                snippet.package_id,
                snippet.tags,
                snippet.variables,
              ],
            )
          } else if (importMode === 'replace') {
            await executeQuery(
              `UPDATE snippets SET name = ?, description = ?, script = ?, package_id = ?, tags = ?, variables = ? WHERE id = ?`,
              [
                snippet.name,
                snippet.description,
                snippet.script,
                snippet.package_id,
                snippet.tags,
                snippet.variables,
                snippet.id,
              ],
            )
          }
        }
      }

      if (data.snippetPackages && data.snippetPackages.length > 0) {
        for (const pkg of data.snippetPackages as Record<string, unknown>[]) {
          const existing = await select<{ id: string }>(
            'SELECT id FROM snippet_packages WHERE id = ?',
            [pkg.id as string],
          )
          if (existing.length === 0) {
            await executeQuery(
              `INSERT INTO snippet_packages (id, name, description) VALUES (?, ?, ?)`,
              [pkg.id, pkg.name, pkg.description],
            )
          } else if (importMode === 'replace') {
            await executeQuery(
              `UPDATE snippet_packages SET name = ?, description = ? WHERE id = ?`,
              [pkg.name, pkg.description, pkg.id],
            )
          }
        }
      }

      setImportStep('success')
      setTimeout(() => {
        resetSyncState()
        loadSettings()
      }, 1500)
    } catch (error) {
      console.error('Import failed:', error)
      setErrorMessage(`Import failed: ${error}`)
      setImportStep('error')
    }
  }

  if (loading || !settings) {
    return (
      <ViewContainer>
        <ViewContent className="flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </ViewContent>
      </ViewContainer>
    )
  }

  return (
    <ViewContainer>
      <ViewHeader
        title={t('settings.title')}
        description={t('settings.description')}
      />

      <ViewContent className="px-6 pb-6">
        <Tabs defaultValue="appearance" className="w-full max-w-3xl">
          <TabsList className="grid w-full grid-cols-6 mb-6">
            <TabsTrigger value="appearance">
              {t('settings.appearance')}
            </TabsTrigger>
            <TabsTrigger value="terminal">{t('settings.terminal')}</TabsTrigger>
            <TabsTrigger value="connection">
              {t('settings.connection')}
            </TabsTrigger>
            <TabsTrigger value="storage">{t('settings.storage')}</TabsTrigger>
            <TabsTrigger value="team">{t('settings.team')}</TabsTrigger>
            <TabsTrigger value="data">{t('settings.data')}</TabsTrigger>
          </TabsList>

          {/* Appearance Tab */}
          <TabsContent value="appearance" className="space-y-6">
            <div className="bg-card rounded-lg border p-4 space-y-4">
              <h3 className="text-sm font-medium">{t('settings.theme')}</h3>
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  className={`
                    flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all text-center
                    ${
                      settings.theme === 'light'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }
                  `}
                  onClick={() => updateSetting('theme', 'light')}
                >
                  <div className="w-full h-8 rounded bg-white border" />
                  <span className="text-sm font-medium">
                    {t('settings.light')}
                  </span>
                </button>
                <button
                  type="button"
                  className={`
                    flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all text-center
                    ${
                      settings.theme === 'dark'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }
                  `}
                  onClick={() => updateSetting('theme', 'dark')}
                >
                  <div className="w-full h-8 rounded bg-zinc-900 border border-zinc-700" />
                  <span className="text-sm font-medium">
                    {t('settings.dark')}
                  </span>
                </button>
                <button
                  type="button"
                  className={`
                    flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all text-center
                    ${
                      settings.theme === 'system'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }
                  `}
                  onClick={() => updateSetting('theme', 'system')}
                >
                  <div className="w-full h-8 rounded bg-gradient-to-r from-white to-zinc-900 border" />
                  <span className="text-sm font-medium">
                    {t('settings.system')}
                  </span>
                </button>
              </div>
            </div>

            <div className="bg-card rounded-lg border p-4 space-y-4">
              <h3 className="text-sm font-medium">{t('settings.language')}</h3>
              <Select
                value={settings.language}
                onValueChange={(value: string) =>
                  updateSetting('language', value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{t('settings.english')}</SelectItem>
                  <SelectItem value="cn">{t('settings.chinese')}</SelectItem>
                  <SelectItem value="fr">{t('settings.french')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          {/* Terminal Tab */}
          <TabsContent value="terminal" className="space-y-6">
            <div className="bg-card rounded-lg border p-4 space-y-4">
              <h3 className="text-sm font-medium">{t('settings.font')}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="fontSize">{t('settings.fontSize')}</Label>
                  <Input
                    id="fontSize"
                    type="number"
                    min={8}
                    max={32}
                    value={settings.fontSize}
                    onChange={e =>
                      updateSetting(
                        'fontSize',
                        Number.parseInt(e.target.value) || 14,
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fontFamily">{t('settings.fontFamily')}</Label>
                  <Input
                    id="fontFamily"
                    value={settings.fontFamily}
                    onChange={e => updateSetting('fontFamily', e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg border p-4 space-y-4">
              <h3 className="text-sm font-medium">{t('settings.cursor')}</h3>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cursorStyle">
                    {t('settings.cursorStyle')}
                  </Label>
                  <Select
                    value={settings.cursorStyle}
                    onValueChange={value =>
                      updateSetting(
                        'cursorStyle',
                        value as 'block' | 'underline' | 'bar',
                      )
                    }
                  >
                    <SelectTrigger id="cursorStyle">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="block">
                        {t('settings.blockCursor')}
                      </SelectItem>
                      <SelectItem value="underline">
                        {t('settings.underlineCursor')}
                      </SelectItem>
                      <SelectItem value="bar">
                        {t('settings.barCursor')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="cursorBlink">
                      {t('settings.cursorBlink')}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t('settings.cursorBlinkDesc')}
                    </p>
                  </div>
                  <Switch
                    id="cursorBlink"
                    checked={settings.cursorBlink}
                    onCheckedChange={checked =>
                      updateSetting('cursorBlink', checked)
                    }
                  />
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg border p-4 space-y-4">
              <h3 className="text-sm font-medium">
                {t('settings.scrollback')}
              </h3>
              <div className="space-y-2">
                <Label htmlFor="scrollback">
                  {t('settings.scrollbackLines')}
                </Label>
                <Input
                  id="scrollback"
                  type="number"
                  min={1000}
                  max={100000}
                  value={settings.scrollback}
                  onChange={e =>
                    updateSetting(
                      'scrollback',
                      Number.parseInt(e.target.value) || 10000,
                    )
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {t('settings.scrollbackDesc')}
                </p>
              </div>
            </div>

            <div className="bg-card rounded-lg border p-4 space-y-4">
              <h3 className="text-sm font-medium">
                {t('settings.terminalTheme')}
              </h3>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'one-dark', name: 'One Dark', bg: '#282c34' },
                  { id: 'monokai', name: 'Monokai', bg: '#272822' },
                  { id: 'dracula', name: 'Dracula', bg: '#282a36' },
                  { id: 'nord', name: 'Nord', bg: '#2e3440' },
                  { id: 'catppuccin', name: 'Catppuccin', bg: '#1e1e28' },
                  { id: 'github-dark', name: 'GitHub Dark', bg: '#0d1117' },
                  { id: 'solarized-dark', name: 'Solarized', bg: '#002b36' },
                  {
                    id: 'solarized-light',
                    name: 'Solarized Light',
                    bg: '#fdf6e3',
                  },
                ].map(theme => (
                  <button
                    key={theme.id}
                    type="button"
                    className={`
                      flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all text-center
                      ${
                        (settings.terminalTheme || 'one-dark') === theme.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      }
                    `}
                    onClick={() =>
                      updateSetting(
                        'terminalTheme',
                        theme.id as typeof settings.terminalTheme,
                      )
                    }
                  >
                    <div
                      className="w-full h-6 rounded"
                      style={{ backgroundColor: theme.bg }}
                    />
                    <span className="text-xs font-medium">{theme.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* Connection Tab */}
          <TabsContent value="connection" className="space-y-6">
            <div className="bg-card rounded-lg border p-4 space-y-4">
              <h3 className="text-sm font-medium">{t('settings.selection')}</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="copyOnSelect">
                      {t('settings.copyOnSelect')}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t('settings.copyOnSelectDesc')}
                    </p>
                  </div>
                  <Switch
                    id="copyOnSelect"
                    checked={settings.copyOnSelect}
                    onCheckedChange={checked =>
                      updateSetting('copyOnSelect', checked)
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="pasteOnMiddleClick">
                      {t('settings.pasteOnMiddleClick')}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t('settings.pasteOnMiddleClickDesc')}
                    </p>
                  </div>
                  <Switch
                    id="pasteOnMiddleClick"
                    checked={settings.pasteOnMiddleClick}
                    onCheckedChange={checked =>
                      updateSetting('pasteOnMiddleClick', checked)
                    }
                  />
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg border p-4 space-y-4">
              <h3 className="text-sm font-medium">{t('settings.advanced')}</h3>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="allowProposedApi">
                    {t('settings.allowProposedApi')}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t('settings.allowProposedApiDesc')}
                  </p>
                </div>
                <Switch
                  id="allowProposedApi"
                  checked={settings.allowProposedApi}
                  onCheckedChange={checked =>
                    updateSetting('allowProposedApi', checked)
                  }
                />
              </div>
            </div>
          </TabsContent>

          {/* Storage Tab */}
          <TabsContent value="storage" className="space-y-6">
            <div className="bg-card rounded-lg border p-4 space-y-4">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                {t('settings.storageMode')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('settings.storageModeDesc')}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className={`
                    flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all text-center
                    ${
                      settings.dataStorageMode === 'local'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }
                  `}
                  onClick={() => updateSetting('dataStorageMode', 'local')}
                >
                  <HardDrive
                    className={`h-6 w-6 ${settings.dataStorageMode === 'local' ? 'text-primary' : 'text-muted-foreground'}`}
                  />
                  <span className="text-sm font-medium">
                    {t('settings.local')}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('settings.localDesc')}
                  </span>
                </button>
                <button
                  type="button"
                  className={`
                    flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all text-center
                    ${
                      settings.dataStorageMode === 'service'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }
                  `}
                  onClick={() => updateSetting('dataStorageMode', 'service')}
                >
                  <Server
                    className={`h-6 w-6 ${settings.dataStorageMode === 'service' ? 'text-primary' : 'text-muted-foreground'}`}
                  />
                  <span className="text-sm font-medium">
                    {t('settings.service')}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('settings.serviceDesc')}
                  </span>
                </button>
              </div>
            </div>

            {settings.dataStorageMode === 'service' && (
              <div className="bg-card rounded-lg border p-4 space-y-4">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  {t('settings.syncService')}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t('settings.syncServiceDesc')}
                </p>

                <div className="space-y-2">
                  <Label htmlFor="syncServiceType">
                    {t('settings.serviceType')}
                  </Label>
                  <Select
                    value={settings.syncServiceType}
                    onValueChange={value =>
                      updateSetting(
                        'syncServiceType',
                        value as 'webdav' | 's3' | 'custom',
                      )
                    }
                  >
                    <SelectTrigger id="syncServiceType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="webdav">WebDAV</SelectItem>
                      <SelectItem value="s3">S3 / S3-Compatible</SelectItem>
                      <SelectItem value="custom">Custom REST API</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="syncServiceEndpoint">
                    {t('settings.endpoint')}
                  </Label>
                  <Input
                    id="syncServiceEndpoint"
                    placeholder={
                      settings.syncServiceType === 'webdav'
                        ? 'https://dav.example.com/backup/'
                        : settings.syncServiceType === 's3'
                          ? 'https://s3.example.com/bucket/'
                          : 'https://api.example.com/sync/'
                    }
                    value={settings.syncServiceEndpoint}
                    onChange={e =>
                      updateSetting('syncServiceEndpoint', e.target.value)
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="syncServiceUsername">
                    {settings.syncServiceType === 's3'
                      ? 'Access Key ID'
                      : t('settings.username')}
                  </Label>
                  <Input
                    id="syncServiceUsername"
                    value={settings.syncServiceUsername}
                    onChange={e =>
                      updateSetting('syncServiceUsername', e.target.value)
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="syncServiceToken">
                    {t('settings.password')}
                  </Label>
                  <div className="relative">
                    <Input
                      id="syncServiceToken"
                      type={showTokenVisible ? 'text' : 'password'}
                      value={settings.syncServiceToken}
                      onChange={e =>
                        updateSetting('syncServiceToken', e.target.value)
                      }
                      className="pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowTokenVisible(v => !v)}
                    >
                      {showTokenVisible ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {settings.syncServiceType === 's3' && (
                  <div className="space-y-2">
                    <Label htmlFor="syncServiceBucket">
                      {t('settings.bucket')}
                    </Label>
                    <Input
                      id="syncServiceBucket"
                      value={settings.syncServiceBucket || ''}
                      onChange={e =>
                        updateSetting('syncServiceBucket', e.target.value)
                      }
                    />
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={
                      !settings.syncServiceEndpoint || testingConnection
                    }
                    onClick={handleTestConnection}
                  >
                    {testingConnection ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {t('settings.testing')}
                      </>
                    ) : connectionStatus === 'success' ? (
                      <>
                        <Check className="h-4 w-4 mr-2 text-green-500" />
                        {t('settings.connected')}
                      </>
                    ) : connectionStatus === 'error' ? (
                      <>
                        <AlertCircle className="h-4 w-4 mr-2 text-red-500" />
                        {t('settings.failed')}
                      </>
                    ) : (
                      <>
                        <Server className="h-4 w-4 mr-2" />
                        {t('settings.testConnection')}
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={
                      !settings.syncServiceEndpoint ||
                      syncing ||
                      connectionStatus !== 'success'
                    }
                    onClick={handleSyncToServer}
                  >
                    {syncing ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        {t('settings.syncing')}
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        {t('settings.syncNow')}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Team Tab */}
          <TabsContent value="team" className="space-y-6">
            <div className="bg-card rounded-lg border p-4 space-y-4">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4" />
                {t('settings.teamCollaboration')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('settings.teamCollaborationDesc')}
              </p>

              {isTeamEnabled ? (
                <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <Check className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">
                      {t('settings.teamEnabled')}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">
                    {t('settings.teamEnabledDesc')}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 ml-6"
                    onClick={() => navigate('/teams')}
                  >
                    <Users className="h-3 w-3 mr-1" />
                    {t('settings.openTeams')}
                  </Button>
                </div>
              ) : (
                <div className="p-3 bg-muted rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {t('settings.teamDisabled')}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">
                    {t('settings.teamDisabledDesc')}
                  </p>
                  <Button
                    size="sm"
                    className="mt-3 ml-6"
                    onClick={() => navigate('/teams')}
                  >
                    <Users className="h-3 w-3 mr-1" />
                    {t('settings.enableTeam')}
                  </Button>
                </div>
              )}
            </div>

            <Separator />

            <TeamServerConfig onClose={() => {}} />
          </TabsContent>

          {/* Data Tab */}
          <TabsContent value="data" className="space-y-6">
            <div className="bg-card rounded-lg border p-4 space-y-4">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Package className="h-4 w-4" />
                {t('settings.exportData')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('settings.exportDesc')}
              </p>
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={exporting}
                className="w-full"
              >
                {exporting ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    {t('settings.exporting')}
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    {t('settings.exportJson')}
                  </>
                )}
              </Button>
            </div>

            <Separator />

            <div className="bg-card rounded-lg border p-4 space-y-4">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Upload className="h-4 w-4" />
                {t('settings.importData')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('settings.importDesc')}
              </p>

              {importStep === 'idle' && (
                <Button
                  variant="outline"
                  onClick={handleSelectImportFile}
                  className="w-full"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {t('settings.selectImportFile')}
                </Button>
              )}

              {importStep === 'preview' && importPreview && (
                <div className="space-y-3 p-3 bg-muted rounded-lg">
                  <p className="text-sm font-medium">
                    {t('settings.importPreview')}
                  </p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>
                      <Check className="h-3 w-3 inline mr-1 text-green-500" />
                      {t('settings.hosts', { count: importPreview.hosts })}
                    </li>
                    <li>
                      <Check className="h-3 w-3 inline mr-1 text-green-500" />
                      {t('settings.groups', { count: importPreview.groups })}
                    </li>
                    <li>
                      <Check className="h-3 w-3 inline mr-1 text-green-500" />
                      {t('settings.snippets', {
                        count: importPreview.snippets,
                      })}
                    </li>
                    {importPreview.snippetPackages > 0 && (
                      <li>
                        <Check className="h-3 w-3 inline mr-1 text-green-500" />
                        {t('settings.snippetPackages', {
                          count: importPreview.snippetPackages,
                        })}
                      </li>
                    )}
                  </ul>

                  <div className="space-y-2 pt-2">
                    <Label className="text-xs">
                      {t('settings.importMode')}
                    </Label>
                    <div className="flex gap-2">
                      <Button
                        variant={importMode === 'merge' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setImportMode('merge')}
                        className="flex-1"
                      >
                        <Merge className="h-3 w-3 mr-1" />
                        {t('settings.merge')}
                      </Button>
                      <Button
                        variant={
                          importMode === 'replace' ? 'default' : 'outline'
                        }
                        size="sm"
                        onClick={() => setImportMode('replace')}
                        className="flex-1"
                      >
                        <Replace className="h-3 w-3 mr-1" />
                        {t('settings.replace')}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {importMode === 'merge'
                        ? t('settings.mergeDesc')
                        : t('settings.replaceDesc')}
                    </p>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={resetSyncState}
                      className="flex-1"
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button size="sm" onClick={handleImport} className="flex-1">
                      <Upload className="h-3 w-3 mr-1" />
                      {t('settings.import')}
                    </Button>
                  </div>
                </div>
              )}

              {importStep === 'importing' && (
                <div className="text-center py-4">
                  <RefreshCw className="h-6 w-6 mx-auto animate-spin text-primary" />
                  <p className="mt-2 text-sm">{t('settings.importing')}</p>
                </div>
              )}

              {importStep === 'success' && (
                <div className="text-center py-4">
                  <div className="h-8 w-8 mx-auto rounded-full bg-green-100 flex items-center justify-center">
                    <Check className="h-5 w-5 text-green-600" />
                  </div>
                  <p className="mt-2 text-sm">{t('settings.importSuccess')}</p>
                </div>
              )}

              {importStep === 'error' && (
                <div className="space-y-2">
                  <div className="p-3 bg-destructive/10 rounded-lg flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <p className="text-sm text-destructive">{errorMessage}</p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={resetSyncState}
                    className="w-full"
                  >
                    {t('settings.tryAgain')}
                  </Button>
                </div>
              )}
            </div>

            <div className="p-3 bg-muted/50 rounded-lg flex items-start gap-2">
              <Shield className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                {t('settings.securityWarning')}
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-6 pt-4 border-t">
          <Button onClick={handleSave} size="lg">
            {t('common.save')}
          </Button>
        </div>
      </ViewContent>
    </ViewContainer>
  )
}

export default SettingsView
