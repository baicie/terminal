import type { AppSettings } from '@/service/database'
import {
  AlertCircle,
  Check,
  HardDrive,
  Loader2,
  RefreshCw,
  Server,
  Upload,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import {
  storageHealthCheck,
  storageInit,
} from '@/service/storage'
import { exportDataToFile } from '@/service/sync'

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
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'success' | 'error'
  >('idle')
  const [syncing, setSyncing] = useState(false)
  const [showTokenVisible, setShowTokenVisible] = useState(false)

  const handleTestConnection = async () => {
    if (!settings.syncServiceEndpoint) return

    setTestingConnection(true)
    setConnectionStatus('idle')

    try {
      await storageInit(
        settings.syncServiceType as 'webdav' | 's3' | 'custom',
        settings.syncServiceEndpoint,
        {
          username: settings.syncServiceUsername || undefined,
          password: settings.syncServiceToken || undefined,
          bucket: settings.syncServiceBucket || undefined,
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
    if (!settings.syncServiceEndpoint) return

    setSyncing(true)

    try {
      await exportDataToFile()
      // Simplified - actual implementation would upload file
    } catch (error) {
      console.error('Sync failed:', error)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Storage Mode */}
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
            onClick={() => onSettingChange('dataStorageMode', 'local')}
          >
            <HardDrive
              className={`h-6 w-6 ${
                settings.dataStorageMode === 'local' ? 'text-primary' : 'text-muted-foreground'
              }`}
            />
            <span className="text-sm font-medium">{t('settings.local')}</span>
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
            onClick={() => onSettingChange('dataStorageMode', 'service')}
          >
            <Server
              className={`h-6 w-6 ${
                settings.dataStorageMode === 'service' ? 'text-primary' : 'text-muted-foreground'
              }`}
            />
            <span className="text-sm font-medium">{t('settings.service')}</span>
            <span className="text-xs text-muted-foreground">
              {t('settings.serviceDesc')}
            </span>
          </button>
        </div>
      </div>

      {/* Service Configuration */}
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
            <Label htmlFor="syncServiceType">{t('settings.serviceType')}</Label>
            <Select
              value={settings.syncServiceType}
              onValueChange={value =>
                onSettingChange(
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
            <Label htmlFor="syncServiceEndpoint">{t('settings.endpoint')}</Label>
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
                onSettingChange('syncServiceEndpoint', e.target.value)
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
                onSettingChange('syncServiceUsername', e.target.value)
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="syncServiceToken">{t('settings.password')}</Label>
            <div className="relative">
              <Input
                id="syncServiceToken"
                type={showTokenVisible ? 'text' : 'password'}
                value={settings.syncServiceToken}
                onChange={e =>
                  onSettingChange('syncServiceToken', e.target.value)
                }
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowTokenVisible(v => !v)}
              >
                {showTokenVisible ? (
                  <RefreshCw className="h-4 w-4" />
                ) : (
                  <Server className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {settings.syncServiceType === 's3' && (
            <div className="space-y-2">
              <Label htmlFor="syncServiceBucket">{t('settings.bucket')}</Label>
              <Input
                id="syncServiceBucket"
                value={settings.syncServiceBucket || ''}
                onChange={e =>
                  onSettingChange('syncServiceBucket', e.target.value)
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
    </div>
  )
}
