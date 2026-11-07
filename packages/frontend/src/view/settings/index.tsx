import type { AppSettings } from '@/service/database'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
  const [savedSettings, setSavedSettings] = useState<AppSettings | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const dirty = settings !== null && savedSettings !== null
    && JSON.stringify(settings) !== JSON.stringify(savedSettings)
  // A preview the user never saved must not survive leaving the page: it would
  // make the app look like it persisted a language/theme that the database
  // does not have.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const savedRef = useRef<AppSettings | null>(savedSettings)
  savedRef.current = savedSettings

  useEffect(() => {
    void loadSettings()
    return () => {
      const saved = savedRef.current
      if (!dirtyRef.current || saved === null) return
      app.setTheme(saved.theme)
      app.setLanguage(saved.language)
      void i18nCore.changeLanguage(saved.language)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadSettings = async () => {
    setStatus('loading')
    setLoadError(null)
    try {
      const loaded = await getAppSettings()
      setSettings(loaded)
      setSavedSettings(loaded)
      setStatus('ready')
    } catch (error) {
      console.error('Failed to load settings:', error)
      setLoadError(error instanceof Error ? error.message : String(error))
      setStatus('error')
    }
  }

  const handleSave = async () => {
    if (!settings || saving) return
    setSaving(true)
    try {
      await saveAppSettings(settings)
      setSavedSettings(settings)
      app.setTheme(settings.theme)
      app.setLanguage(settings.language)
      await i18nCore.changeLanguage(settings.language)
      toast.success(t('settings.saved'))
    } catch (error) {
      console.error('Failed to save settings:', error)
      toast.error(t('settings.saveFailed'))
    } finally {
      setSaving(false)
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

  if (status === 'loading') {
    return (
      <ViewContainer>
        <ViewContent className="flex items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </ViewContent>
      </ViewContainer>
    )
  }

  if (status === 'error' || settings === null) {
    return (
      <ViewContainer>
        <ViewContent className="flex items-center justify-center p-6">
          <div className="max-w-md space-y-3 text-center">
            <p className="font-medium text-destructive">
              {t('settings.loadFailed')}
            </p>
            {loadError ? (
              <p className="font-mono text-xs break-all text-muted-foreground">
                {loadError}
              </p>
            ) : null}
            <Button variant="outline" onClick={() => void loadSettings()}>
              {t('common.retry')}
            </Button>
          </div>
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
          <TabsList className="mb-6 grid h-auto w-full grid-cols-3 sm:grid-cols-6">
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
            <DataSettings />
          </TabsContent>
        </Tabs>

        <div className="mt-6 flex items-center gap-3 border-t pt-4">
          <Button onClick={handleSave} size="lg" disabled={saving || !dirty}>
            {saving ? t('settings.saving') : t('common.save')}
          </Button>
          {dirty ? (
            <span className="text-xs text-muted-foreground">
              {t('settings.unsavedChanges')}
            </span>
          ) : null}
        </div>
      </ViewContent>
    </ViewContainer>
  )
}

export default SettingsView
