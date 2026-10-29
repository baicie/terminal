import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/sonner'
import {
  useStorageSync,
  type StorageServiceConfig,
} from '@/hooks/use-storage-sync'
import { StorageModeSection } from './storage-mode-section'
import { StorageServiceSection } from './storage-service-section'
import { StorageSyncActions } from './storage-sync-actions'
import type {
  StorageSettings,
  UpdateStorageSetting,
} from './storage-settings-types'

export interface StorageSettingsDialogProps {
  settings: StorageSettings
  updateSetting: UpdateStorageSetting
  onSyncComplete?: () => void
}

export function StorageSettingsDialog({
  settings,
  updateSetting,
  onSyncComplete,
}: StorageSettingsDialogProps) {
  const { t } = useTranslation()
  const [showTokenVisible, setShowTokenVisible] = useState(false)
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge')
  const getConfig = (): StorageServiceConfig | null =>
    settings.syncServiceEndpoint
      ? {
          type: settings.syncServiceType,
          endpoint: settings.syncServiceEndpoint,
          username: settings.syncServiceUsername,
          password: settings.syncServiceToken,
          bucket: settings.syncServiceBucket,
          region: settings.syncServiceRegion,
        }
      : null
  const sync = useStorageSync({ getConfig })
  const onTestConnection = async () => {
    if (!settings.syncServiceEndpoint) {
      toast.error(t('settings.testConnection'), {
        description: t('settings.enterEndpoint'),
      })
      return
    }
    await sync.handleTestConnection()
  }
  const onSync = async () => {
    await sync.handleSyncToServer()
    onSyncComplete?.()
  }
  const onRestore = async () => {
    await sync.handleRestoreFromServer(restoreMode)
    onSyncComplete?.()
  }
  return (
    <div className="space-y-6 py-4">
      <StorageModeSection
        settings={settings}
        updateSetting={updateSetting}
        t={t}
      />
      <StorageServiceSection
        settings={settings}
        updateSetting={updateSetting}
        t={t}
        showTokenVisible={showTokenVisible}
        onToggleToken={() => setShowTokenVisible(v => !v)}
      />
      <StorageSyncActions
        t={t}
        endpoint={settings.syncServiceEndpoint}
        testingConnection={sync.testingConnection}
        connectionStatus={sync.connectionStatus}
        syncing={sync.syncing}
        restoring={sync.restoring}
        lastSyncTime={sync.lastSyncTime}
        restoreMode={restoreMode}
        onRestoreModeChange={value =>
          setRestoreMode(value as 'merge' | 'replace')
        }
        onTestConnection={onTestConnection}
        onSync={onSync}
        onPreview={sync.handlePreviewServerData}
        onRestore={onRestore}
        canPreview={
          sync.connectionStatus === 'success' && !!settings.syncServiceEndpoint
        }
        isSyncDisabled={sync.isSyncDisabled}
        showRestore={settings.dataStorageMode === 'service'}
      />
    </div>
  )
}
