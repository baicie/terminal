import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  useStorageSync,
  type StorageServiceConfig,
} from '@/hooks/use-storage-sync'
import type { AppSettings } from '@/service/database'
import { StorageModePanel } from './storage-mode-panel'
import { StorageServicePanel } from './storage-service-panel'
import { StorageSyncPanel } from './storage-sync-panel'

interface StorageSettingsProps {
  settings: AppSettings
  onSettingChange: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => void
}

export const StorageSettings: React.FC<StorageSettingsProps> = ({
  settings,
  onSettingChange,
}) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [showTokenVisible, setShowTokenVisible] = useState(false)
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge')

  const getConfig = useCallback((): StorageServiceConfig | null => {
    if (!settings.syncServiceEndpoint) return null
    return {
      type: settings.syncServiceType,
      endpoint: settings.syncServiceEndpoint,
      username: settings.syncServiceUsername,
      password: settings.syncServiceToken,
      bucket: settings.syncServiceBucket,
      region: settings.syncServiceRegion,
    }
  }, [settings])

  const sync = useStorageSync({ getConfig })

  const handleTest = async () => {
    if (settings.syncServiceEndpoint) await sync.handleTestConnection()
  }
  const handleSync = async () => {
    if (settings.syncServiceEndpoint) await sync.handleSyncToServer()
  }
  const handleRestore = async () => {
    if (settings.syncServiceEndpoint) {
      await sync.handleRestoreFromServer(restoreMode)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <StorageModePanel
        settings={settings}
        onSettingChange={onSettingChange}
        t={t}
      />

      {settings.dataStorageMode === 'service' && (
        <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
          <StorageServicePanel
            settings={settings}
            onSettingChange={onSettingChange}
            showTokenVisible={showTokenVisible}
            onToggleToken={() => setShowTokenVisible(visible => !visible)}
            t={t}
          />
          <StorageSyncPanel
            endpoint={settings.syncServiceEndpoint}
            restoreMode={restoreMode}
            onRestoreModeChange={setRestoreMode}
            onTest={handleTest}
            onSync={handleSync}
            onRestore={handleRestore}
            onPreview={sync.handlePreviewServerData}
            onOpenTeams={() => navigate('/teams')}
            sync={sync}
            t={t}
          />
        </div>
      )}
    </div>
  )
}
