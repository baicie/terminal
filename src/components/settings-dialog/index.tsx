import type { AppSettings } from '@/service/database'
import type { ExportData } from '@/service/sync'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import {
  AlertCircle,
  Check,
  Download,
  Eye,
  EyeOff,
  HardDrive,
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
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { toast } from '@/components/ui/sonner'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import i18nCore from '@/locales'
import {
  executeQuery,
  getAppSettings,
  saveAppSettings,
  select,
} from '@/service/database'
import { exportDataToFile, previewImportData } from '@/service/sync'
import { useAppStore } from '@/store/app'
import { useIsTeamEnabled } from '@/store/team'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

type ImportStep = 'idle' | 'preview' | 'importing' | 'success' | 'error'

interface ImportPreview {
  hosts: number
  groups: number
  snippets: number
  snippetPackages: number
  workspaces: number
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({ open, onClose }) => {
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

  useEffect(() => {
    if (open) {
      loadSettings()
    }
  }, [open])

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
      onClose()
    } catch (error) {
      console.error('Failed to save settings:', error)
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
        toast.success('Export successful', { description: filePath })
      }
    } catch (error) {
      console.error('Export failed:', error)
      setErrorMessage(`Export failed: ${error}`)
    } finally {
      setExporting(false)
    }
  }

  const handleSelectImportFile = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })

      if (selected) {
        const content = await readTextFile(selected)
        const preview = previewImportData(content)

        if (preview) {
          setImportContent(content)
          setImportPreview({
            hosts: preview.hosts?.length || 0,
            groups: preview.groups?.length || 0,
            snippets: preview.snippets?.length || 0,
            snippetPackages: preview.snippetPackages?.length || 0,
            workspaces: preview.workspaces?.length || 0,
          })
          setImportStep('preview')
        } else {
          setErrorMessage('Invalid export file format')
          setImportStep('error')
        }
      }
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

      // Import in order: groups first, then hosts, then snippets
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

      // Import snippet packages
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
        onClose()
      }, 1500)
    } catch (error) {
      console.error('Import failed:', error)
      setErrorMessage(`Import failed: ${error}`)
      setImportStep('error')
    }
  }

  if (loading || !settings) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <div className="py-8 text-center">Loading...</div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="appearance" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="storage">Storage</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
          </TabsList>

          <TabsContent value="appearance" className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="theme">Theme</Label>
              <Select
                value={settings.theme}
                onValueChange={value =>
                  updateSetting('theme', value as 'light' | 'dark' | 'system')
                }
              >
                <SelectTrigger id="theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="language">Language</Label>
              <Select
                value={settings.language}
                onValueChange={(value: string) =>
                  updateSetting('language', value)
                }
              >
                <SelectTrigger id="language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="cn">中文</SelectItem>
                  <SelectItem value="fr">Français</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="storage" className="space-y-6 py-4">
            {/* Storage Mode */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                Storage Mode
              </h4>
              <p className="text-sm text-muted-foreground">
                Choose how your data is stored. Local mode keeps everything on
                this device. Service mode enables syncing across devices via a
                remote server.
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
                  <span className="text-sm font-medium">Local</span>
                  <span className="text-xs text-muted-foreground">
                    SQLite on this device
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
                  <span className="text-sm font-medium">Service</span>
                  <span className="text-xs text-muted-foreground">
                    Sync via remote server
                  </span>
                </button>
              </div>
            </div>

            <Separator />

            {/* Sync Service Configuration */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Server className="h-4 w-4" />
                Sync Service
              </h4>
              <p className="text-sm text-muted-foreground">
                Configure a remote service to sync your data across devices.
                Credentials are stored locally.
              </p>

              <div className="space-y-2">
                <Label htmlFor="syncServiceType">Service Type</Label>
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
                <Label htmlFor="syncServiceEndpoint">Endpoint URL</Label>
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
                    : 'Username'}
                </Label>
                <Input
                  id="syncServiceUsername"
                  placeholder={
                    settings.syncServiceType === 's3'
                      ? 'AKIAIOSFODNN7EXAMPLE'
                      : 'Username'
                  }
                  value={settings.syncServiceUsername}
                  onChange={e =>
                    updateSetting('syncServiceUsername', e.target.value)
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="syncServiceToken">
                  {settings.syncServiceType === 's3'
                    ? 'Secret Access Key'
                    : settings.syncServiceType === 'webdav'
                      ? 'Password / Token'
                      : 'API Token'}
                </Label>
                <div className="relative">
                  <Input
                    id="syncServiceToken"
                    type={showTokenVisible ? 'text' : 'password'}
                    placeholder={
                      settings.syncServiceType === 's3'
                        ? 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
                        : '••••••••'
                    }
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
            </div>

            <Separator />

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={!settings.syncServiceEndpoint}
              >
                <Server className="h-4 w-4 mr-2" />
                Test Connection
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                disabled={!settings.syncServiceEndpoint}
                onClick={handleExport}
              >
                <Upload className="h-4 w-4 mr-2" />
                Sync Now
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="terminal" className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="fontSize">Font Size</Label>
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
              <Label htmlFor="fontFamily">Font Family</Label>
              <Input
                id="fontFamily"
                value={settings.fontFamily}
                onChange={e => updateSetting('fontFamily', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cursorStyle">Cursor Style</Label>
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
                  <SelectItem value="block">Block</SelectItem>
                  <SelectItem value="underline">Underline</SelectItem>
                  <SelectItem value="bar">Bar</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="cursorBlink">Cursor Blink</Label>
              <Switch
                id="cursorBlink"
                checked={settings.cursorBlink}
                onCheckedChange={checked =>
                  updateSetting('cursorBlink', checked)
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="scrollback">Scrollback Lines</Label>
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
            </div>
          </TabsContent>

          <TabsContent value="general" className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="copyOnSelect">Copy on Select</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically copy selection to clipboard
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
                  Paste on Middle Click
                </Label>
                <p className="text-sm text-muted-foreground">
                  Paste clipboard content on middle mouse button click
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

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="allowProposedApi">Allow Proposed API</Label>
                <p className="text-sm text-muted-foreground">
                  Enable xterm.js proposed API features
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
          </TabsContent>

          <TabsContent value="team" className="space-y-6 py-4">
            {/* Team Status */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4" />
                Team Collaboration
              </h4>
              <p className="text-sm text-muted-foreground">
                Enable team features to share hosts and snippets with your team
                members. Use local mode to export/import team packages as JSON
                files.
              </p>

              {isTeamEnabled ? (
                <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <Check className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">
                      Team mode enabled
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">
                    Teams navigation is visible in the sidebar. Manage your
                    teams from the Teams view.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 ml-6"
                    onClick={() => {
                      onClose()
                      navigate('/teams')
                    }}
                  >
                    <Users className="h-3 w-3 mr-1" />
                    Open Teams View
                  </Button>
                </div>
              ) : (
                <div className="p-3 bg-muted rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      Team mode disabled
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">
                    Enable team mode to collaborate with team members.
                  </p>
                  <Button
                    size="sm"
                    className="mt-3 ml-6"
                    onClick={() => {
                      onClose()
                      navigate('/teams')
                    }}
                  >
                    <Users className="h-3 w-3 mr-1" />
                    Enable Team Mode
                  </Button>
                </div>
              )}
            </div>

            <Separator />

            {/* Cloud Server Configuration */}
            <TeamServerConfig onClose={onClose} />

            <Separator />

            {/* Local Export / Import */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Package className="h-4 w-4" />
                Local Export / Import
              </h4>
              <p className="text-sm text-muted-foreground">
                Export or import your data as a JSON file. This works
                independently of team mode.
              </p>

              {/* Export */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Export all hosts, groups, snippets, and settings to a JSON
                  file for backup.
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
                      Exporting...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Export to JSON File
                    </>
                  )}
                </Button>
              </div>

              <Separator />

              {/* Import */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Import data from a JSON export file. Supports both full
                  exports and team packages.
                </p>

                {importStep === 'idle' && (
                  <Button
                    variant="outline"
                    onClick={handleSelectImportFile}
                    className="w-full"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Select Import File
                  </Button>
                )}

                {importStep === 'preview' && importPreview && (
                  <div className="space-y-3 p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium">Import Preview:</p>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>
                        <Check className="h-3 w-3 inline mr-1 text-green-500" />
                        {importPreview.hosts} host(s)
                      </li>
                      <li>
                        <Check className="h-3 w-3 inline mr-1 text-green-500" />
                        {importPreview.groups} group(s)
                      </li>
                      <li>
                        <Check className="h-3 w-3 inline mr-1 text-green-500" />
                        {importPreview.snippets} snippet(s)
                      </li>
                      {importPreview.snippetPackages > 0 && (
                        <li>
                          <Check className="h-3 w-3 inline mr-1 text-green-500" />
                          {importPreview.snippetPackages} snippet package(s)
                        </li>
                      )}
                    </ul>

                    <div className="space-y-2 pt-2">
                      <Label className="text-xs">Import Mode</Label>
                      <div className="flex gap-2">
                        <Button
                          variant={
                            importMode === 'merge' ? 'default' : 'outline'
                          }
                          size="sm"
                          onClick={() => setImportMode('merge')}
                          className="flex-1"
                        >
                          <Merge className="h-3 w-3 mr-1" />
                          Merge
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
                          Replace
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {importMode === 'merge'
                          ? 'New items will be added, existing items will be kept.'
                          : 'Existing items with the same ID will be overwritten.'}
                      </p>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={resetSyncState}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleImport}
                        className="flex-1"
                      >
                        <Upload className="h-3 w-3 mr-1" />
                        Import
                      </Button>
                    </div>
                  </div>
                )}

                {importStep === 'importing' && (
                  <div className="text-center py-4">
                    <RefreshCw className="h-6 w-6 mx-auto animate-spin text-primary" />
                    <p className="mt-2 text-sm">Importing data...</p>
                  </div>
                )}

                {importStep === 'success' && (
                  <div className="text-center py-4">
                    <div className="h-8 w-8 mx-auto rounded-full bg-green-100 flex items-center justify-center">
                      <Check className="h-5 w-5 text-green-600" />
                    </div>
                    <p className="mt-2 text-sm">Import successful!</p>
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
                      Try Again
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="p-3 bg-muted/50 rounded-lg flex items-start gap-2">
              <Shield className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Data is exported as plain JSON. Sensitive information like
                passwords may be included. Keep your export files secure.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default SettingsDialog
