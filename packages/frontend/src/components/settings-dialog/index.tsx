import type { TerminalThemePreset } from '@/service/database'
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import {
  applyNotificationPrefs,
  resetNotificationPermissionCache,
} from '@/service/notifications'
import { syncCloseToTray } from '@/service/window-ux'
import { useAppStore } from '@/store/app'
import { GeneralSettings } from './general-settings'
import { StorageSettingsDialog } from './storage-settings-dialog'
import { TeamSettingsDialog } from './team-settings-dialog'
import { ExportImportSettings } from './export-import-settings'
import { TerminalSettings } from './terminal-settings'
import { ShortcutsSettings } from './shortcuts-settings'

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
  terminalTheme?: TerminalThemePreset
  terminalThemeDark?: TerminalThemePreset
  terminalThemeLight?: TerminalThemePreset
  copyOnSelect?: boolean
  pasteOnMiddleClick?: boolean
  allowProposedApi?: boolean
  minimizeToTray?: boolean
  nativeNotifications?: boolean
  notifyOnlyWhenUnfocused?: boolean
  dataStorageMode?: 'local' | 'service'
  syncServiceType?: 'webdav' | 's3' | 'custom'
  syncServiceEndpoint?: string
  syncServiceUsername?: string
  syncServiceToken?: string
  syncServiceBucket?: string
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({ open, onClose }) => {
  const app = useAppStore()
  const [settings, setSettings] = useState<AppSettingsKey | null>(null)
  const [loading, setLoading] = useState(true)

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
    if (key === 'minimizeToTray') {
      void syncCloseToTray(value as boolean)
    }
    if (key === 'nativeNotifications') {
      resetNotificationPermissionCache()
      applyNotificationPrefs({ nativeNotifications: value as boolean })
    }
    if (key === 'notifyOnlyWhenUnfocused') {
      applyNotificationPrefs({
        notifyOnlyWhenUnfocused: value as boolean,
      })
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
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
            <TabsTrigger value="shortcuts">Shortcuts</TabsTrigger>
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
            <TerminalSettings
              settings={settings}
              updateSetting={updateSetting}
            />
          </TabsContent>

          <TabsContent value="shortcuts" className="space-y-4 py-4">
            <ShortcutsSettings />
          </TabsContent>

          <TabsContent value="general" className="space-y-4 py-4">
            <GeneralSettings
              settings={{
                copyOnSelect: settings.copyOnSelect || false,
                pasteOnMiddleClick: settings.pasteOnMiddleClick || false,
                allowProposedApi: settings.allowProposedApi || false,
                minimizeToTray: settings.minimizeToTray ?? false,
                nativeNotifications: settings.nativeNotifications ?? true,
                notifyOnlyWhenUnfocused:
                  settings.notifyOnlyWhenUnfocused ?? true,
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
