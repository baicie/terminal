import type { AppSettings } from '@/service/database'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ViewContainer,
  ViewContent,
  ViewHeader,
} from '@/components/view-container'
import i18nCore from '@/locales'
import {
  getAppSettings,
  saveAppSettings,
} from '@/service/database'
import { useAppStore } from '@/store/app'

import { AppearanceSettings } from './appearance-settings'
import { ConnectionSettings } from './connection-settings'
import { DataSettings } from './data-settings'
import { StorageSettings } from './storage-settings'
import { TeamSettings } from './team-settings'
import { TerminalSettings } from './terminal-settings'

const SettingsView: React.FC = () => {
  const { t } = useTranslation()
  const app = useAppStore()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)

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
          <TabsContent value="appearance">
            <AppearanceSettings
              settings={settings}
              onSettingChange={updateSetting}
            />
          </TabsContent>

          {/* Terminal Tab */}
          <TabsContent value="terminal">
            <TerminalSettings
              settings={settings}
              onSettingChange={updateSetting}
            />
          </TabsContent>

          {/* Connection Tab */}
          <TabsContent value="connection">
            <ConnectionSettings
              settings={settings}
              onSettingChange={updateSetting}
            />
          </TabsContent>

          {/* Storage Tab */}
          <TabsContent value="storage">
            <StorageSettings
              settings={settings}
              onSettingChange={updateSetting}
            />
          </TabsContent>

          {/* Team Tab */}
          <TabsContent value="team">
            <TeamSettings />
          </TabsContent>

          {/* Data Tab */}
          <TabsContent value="data">
            <DataSettings settings={settings} />
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
