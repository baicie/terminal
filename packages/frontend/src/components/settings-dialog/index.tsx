import type {
  TerminalThemePreset,
  TerminalThemeColors,
} from '@/service/database'
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { UpdateCheck } from './update-check'

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
  customTerminalTheme?: TerminalThemeColors
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
  syncServiceRegion?: string
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({ open, onClose }) => {
  const { t } = useTranslation()
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
            <DialogTitle>{t('settings.title')}</DialogTitle>
          </DialogHeader>
          <div className="py-8 text-center">{t('common.loading')}</div>
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
          <DialogTitle>{t('settings.title')}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="appearance" className="w-full">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="appearance">{t('settings.appearance')}</TabsTrigger>
            <TabsTrigger value="terminal">{t('settings.terminal')}</TabsTrigger>
            <TabsTrigger value="shortcuts">{t('settings.shortcutsTab')}</TabsTrigger>
            <TabsTrigger value="general">{t('settings.general')}</TabsTrigger>
            <TabsTrigger value="storage">{t('settings.storage')}</TabsTrigger>
            <TabsTrigger value="team">{t('settings.team')}</TabsTrigger>
          </TabsList>

          <TabsContent value="appearance" className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="theme">{t('settings.theme')}</Label>
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
                  <SelectItem value="light">{t('settings.light')}</SelectItem>
                  <SelectItem value="dark">{t('settings.dark')}</SelectItem>
                  <SelectItem value="system">{t('settings.system')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="language">{t('settings.language')}</Label>
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
                  <SelectItem value="en">{t('settings.english')}</SelectItem>
                  <SelectItem value="cn">{t('settings.chinese')}</SelectItem>
                  <SelectItem value="fr">{t('settings.french')}</SelectItem>
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
                syncServiceRegion: settings.syncServiceRegion,
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

            <UpdateCheck />
          </TabsContent>

          <TabsContent value="team" className="space-y-6 py-4">
            <TeamSettingsDialog onClose={onClose} />

            <Separator />

            <ExportImportSettings onClose={onClose} />

            <div className="p-3 bg-muted/50 rounded-lg flex items-start gap-2">
              <Check className="size-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                {t('settings.securityWarning')}
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave}>{t('common.save')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default SettingsDialog
