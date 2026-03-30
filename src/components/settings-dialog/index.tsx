import {
  Check,
  Download,
  Eye,
  EyeOff,
  HardDrive,
  Loader2,
  RefreshCw,
  Server,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import i18nCore from '@/locales'
import { getAppSettings, saveAppSettings } from '@/service/database'
import { useAppStore } from '@/store/app'
import { GeneralSettings } from './general-settings'
import { StorageSettingsDialog } from './storage-settings-dialog'
import { TeamSettingsDialog } from './team-settings-dialog'
import { ExportImportSettings } from './export-import-settings'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

type AppSettingsKey = {
  theme?: 'light' | 'dark' | 'system'
  language?: string
  fontSize?: number
  fontFamily?: string
  cursorStyle?: 'block' | 'underline' | 'bar'
  cursorBlink?: boolean
  scrollback?: number
  terminalTheme?: string
  copyOnSelect?: boolean
  pasteOnMiddleClick?: boolean
  allowProposedApi?: boolean
  dataStorageMode?: 'local' | 'service'
  syncServiceType?: 'webdav' | 's3' | 'custom'
  syncServiceEndpoint?: string
  syncServiceUsername?: string
  syncServiceToken?: string
  syncServiceBucket?: string
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({ open, onClose }) => {
  const app = useAppStore()
  const navigate = useNavigate()
  const [settings, setSettings] = useState<AppSettingsKey | null>(null)
  const [loading, setLoading] = useState(true)
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
      app.setTheme(settings.theme || 'system')
      app.setLanguage(settings.language || 'en')
      await i18nCore.changeLanguage(settings.language || 'en')
      onClose()
    } catch (error) {
      console.error('Failed to save settings:', error)
    }
  }

  const updateSetting = <K extends keyof AppSettingsKey>(
    key: K,
    value: AppSettingsKey[K],
  ) => {
    if (settings) {
      setSettings({ ...settings, [key]: value })
    }
    if (key === 'theme') {
      app.setTheme(value as 'light' | 'dark' | 'system')
    }
    if (key === 'language') {
      app.setLanguage(value as string)
      void i18nCore.changeLanguage(value as string)
    }
  }

  if (loading || !settings) {
    return (
      <Dialog
        open={open}
        onOpenChange={next => {
          if (!next) onClose()
        }}
      >
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
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose()
      }}
    >
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
            <StorageSettingsDialog
              settings={{
                dataStorageMode: settings.dataStorageMode || 'local',
                syncServiceType: settings.syncServiceType || 'webdav',
                syncServiceEndpoint: settings.syncServiceEndpoint || '',
                syncServiceUsername: settings.syncServiceUsername,
                syncServiceToken: settings.syncServiceToken,
                syncServiceBucket: settings.syncServiceBucket,
              }}
              updateSetting={updateSetting}
            />
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
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  updateSetting('cursorBlink', !settings.cursorBlink)
                }
              >
                {settings.cursorBlink ? 'On' : 'Off'}
              </Button>
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

            <Separator />

            <div className="space-y-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <span className="text-muted-foreground">Terminal Theme</span>
              </h4>
              <p className="text-sm text-muted-foreground">
                Choose a color theme for the terminal.
              </p>

              <div className="grid grid-cols-3 gap-2">
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

          <TabsContent value="general" className="space-y-4 py-4">
            <GeneralSettings
              settings={{
                copyOnSelect: settings.copyOnSelect || false,
                pasteOnMiddleClick: settings.pasteOnMiddleClick || false,
                allowProposedApi: settings.allowProposedApi || false,
              }}
              updateSetting={updateSetting}
            />
          </TabsContent>

          <TabsContent value="team" className="space-y-6 py-4">
            <TeamSettingsDialog onClose={onClose} />

            <Separator />

            <ExportImportSettings onClose={onClose} />

            <div className="p-3 bg-muted/50 rounded-lg flex items-start gap-2">
              <Check className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
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
