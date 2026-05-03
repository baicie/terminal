import {
  AlertCircle,
  Check,
  Cloud,
  CloudDownload,
  CloudUpload,
  Eye,
  EyeOff,
  HardDrive,
  Loader2,
  Server,
} from 'lucide-react'
import { useEffect, useState } from 'react'
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
import { toast } from '@/components/ui/sonner'
import { downloadFromServer, syncToServer } from '@/service/sync'
import { storageHealthCheck, storageInit } from '@/service/storage'

interface StorageSettingsDialogProps {
  settings: {
    dataStorageMode: 'local' | 'service'
    syncServiceType: 'webdav' | 's3' | 'custom'
    syncServiceEndpoint: string
    syncServiceUsername?: string
    syncServiceToken?: string
    syncServiceBucket?: string
  }
  updateSetting: <K extends 'dataStorageMode' | 'syncServiceType' | 'syncServiceEndpoint' | 'syncServiceUsername' | 'syncServiceToken' | 'syncServiceBucket'>(
    key: K,
    value: StorageSettingsDialogProps['settings'][K],
  ) => void
  onSyncComplete?: () => void
}

export function StorageSettingsDialog({
  settings,
  updateSetting,
  onSyncComplete,
}: StorageSettingsDialogProps) {
  const { t } = useTranslation('settings')
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'success' | 'error'
  >('idle')
  const [syncing, setSyncing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [showTokenVisible, setShowTokenVisible] = useState(false)
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge')
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null)

  // Update last sync time display periodically
  useEffect(() => {
    const updateSyncTime = async () => {
      const { formatLastSyncTime: getSyncTime } = await import('@/service/sync')
      setLastSyncTime(getSyncTime())
    }
    updateSyncTime()
    const interval = setInterval(updateSyncTime, 60000)
    return () => clearInterval(interval)
  }, [])

  const getEndpointPlaceholder = () => {
    switch (settings.syncServiceType) {
      case 'webdav':
        return 'https://dav.example.com/backup/'
      case 's3':
        return 'https://s3.amazonaws.com'
      default:
        return 'https://api.example.com/sync/'
    }
  }

  const getUsernamePlaceholder = () => {
    return settings.syncServiceType === 's3' ? 'AKIAIOSFODNN7EXAMPLE' : t('settings.username')
  }

  const getTokenPlaceholder = () => {
    switch (settings.syncServiceType) {
      case 's3':
        return 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
      case 'webdav':
        return '••••••••'
      default:
        return '••••••••'
    }
  }

  const handleTestConnection = async () => {
    if (!settings.syncServiceEndpoint) {
      toast.error(t('settings.testConnection'), {
        description: t('settings.enterEndpoint'),
      })
      return
    }

    setTestingConnection(true)
    setConnectionStatus('idle')

    try {
      await storageInit(settings.syncServiceType, settings.syncServiceEndpoint, {
        username: settings.syncServiceUsername || undefined,
        password: settings.syncServiceToken || undefined,
        bucket: settings.syncServiceBucket || undefined,
      })

      const healthy = await storageHealthCheck()
        if (healthy) {
        setConnectionStatus('success')
        toast.success(t('settings.connectionSuccess'), {
          description: `Successfully connected to ${settings.syncServiceType} service`,
        })
      } else {
        setConnectionStatus('error')
        toast.error(t('settings.connectionFailed'), {
          description: t('settings.connectionServiceNotReachable'),
        })
      }
    } catch (error) {
      setConnectionStatus('error')
      toast.error(t('settings.connectionFailed'), {
        description: String(error),
      })
    } finally {
      setTestingConnection(false)
    }
  }

  const handleSyncToServer = async () => {
    if (!settings.syncServiceEndpoint) return

    setSyncing(true)

    try {
      await storageInit(settings.syncServiceType, settings.syncServiceEndpoint, {
        username: settings.syncServiceUsername || undefined,
        password: settings.syncServiceToken || undefined,
        bucket: settings.syncServiceBucket || undefined,
      })

      const result = await syncToServer()

      if (result.success) {
        toast.success(t('settings.syncSuccess'), {
          description: t('settings.syncSuccess') + ` — ${result.stats?.hosts || 0} hosts, ${result.stats?.snippets || 0} snippets`,
        })
        const { formatLastSyncTime: getSyncTime } = await import('@/service/sync')
        setLastSyncTime(getSyncTime())
        onSyncComplete?.()
      } else {
        toast.error(t('settings.syncFailed'), {
          description: t('settings.connectionUploadFailed'),
        })
      }
    } catch (error) {
      toast.error(t('settings.syncFailed'), {
        description: String(error),
      })
    } finally {
      setSyncing(false)
    }
  }

  const handleRestoreFromServer = async () => {
    if (!settings.syncServiceEndpoint) return

    setRestoring(true)

    try {
      await storageInit(settings.syncServiceType, settings.syncServiceEndpoint, {
        username: settings.syncServiceUsername || undefined,
        password: settings.syncServiceToken || undefined,
        bucket: settings.syncServiceBucket || undefined,
      })

      const result = await downloadFromServer(restoreMode)

      if (result.success && result.stats) {
        toast.success(t('settings.restoreSuccess'), {
          description: `${result.stats.hosts} hosts, ${result.stats.snippets} snippets, ${result.stats.workspaces} workspaces`,
        })
        const { formatLastSyncTime: getSyncTime } = await import('@/service/sync')
        setLastSyncTime(getSyncTime())
        onSyncComplete?.()
      } else if (!result.success) {
        toast.error(t('settings.noBackupFound'), {
          description: t('settings.connectionNoBackupFound'),
        })
      }
    } catch (error) {
      toast.error(t('settings.restoreFailed'), {
        description: String(error),
      })
    } finally {
      setRestoring(false)
    }
  }

  const isSyncDisabled =
    !settings.syncServiceEndpoint ||
    syncing ||
    restoring ||
    connectionStatus !== 'success'

  return (
    <div className="space-y-6 py-4">
      <div className="space-y-3">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <HardDrive className="h-4 w-4" />
          {t('settings.storageMode')}
        </h4>
        <p className="text-sm text-muted-foreground">{t('settings.storageModeDesc')}</p>
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
              className={`h-6 w-6 ${
                settings.dataStorageMode === 'local'
                  ? 'text-primary'
                  : 'text-muted-foreground'
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
            onClick={() => updateSetting('dataStorageMode', 'service')}
          >
            <Server
              className={`h-6 w-6 ${
                settings.dataStorageMode === 'service'
                  ? 'text-primary'
                  : 'text-muted-foreground'
              }`}
            />
            <span className="text-sm font-medium">{t('settings.service')}</span>
            <span className="text-xs text-muted-foreground">
              {t('settings.serviceDesc')}
            </span>
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Server className="h-4 w-4" />
          {t('settings.syncService')}
        </h4>
        <p className="text-sm text-muted-foreground">{t('settings.syncServiceDesc')}</p>

        <div className="space-y-2">
          <Label htmlFor="syncServiceType">{t('settings.serviceType')}</Label>
          <Select
            value={settings.syncServiceType}
            onValueChange={value =>
              updateSetting('syncServiceType', value as 'webdav' | 's3' | 'custom')
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
            placeholder={getEndpointPlaceholder()}
            value={settings.syncServiceEndpoint}
            onChange={e => updateSetting('syncServiceEndpoint', e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="syncServiceUsername">
            {settings.syncServiceType === 's3' ? 'Access Key ID' : t('settings.username')}
          </Label>
          <Input
            id="syncServiceUsername"
            placeholder={getUsernamePlaceholder()}
            value={settings.syncServiceUsername}
            onChange={e => updateSetting('syncServiceUsername', e.target.value)}
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
              placeholder={getTokenPlaceholder()}
              value={settings.syncServiceToken}
              onChange={e => updateSetting('syncServiceToken', e.target.value)}
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

      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={!settings.syncServiceEndpoint || testingConnection}
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
          disabled={isSyncDisabled}
          onClick={handleSyncToServer}
        >
          {syncing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {t('settings.syncing')}
            </>
          ) : (
            <>
              <CloudUpload className="h-4 w-4 mr-2" />
              {t('settings.syncNow')}
            </>
          )}
        </Button>
      </div>

      {/* Sync Status and Restore Section */}
      <div className="space-y-3 p-3 bg-muted/50 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Cloud className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{t('settings.lastSync')}:</span>
            <span className="font-medium">
              {lastSyncTime || t('settings.never')}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-xs shrink-0">{t('settings.restoreMode')}:</Label>
            <Select
              value={restoreMode}
              onValueChange={value => setRestoreMode(value as 'merge' | 'replace')}
            >
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="merge">{t('settings.merge')}</SelectItem>
                <SelectItem value="replace">{t('settings.replace')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {restoreMode === 'merge'
              ? t('settings.mergeDesc')
              : t('settings.replaceDesc')}
          </p>
        </div>

        <Button
          variant="outline"
          className="w-full"
          disabled={isSyncDisabled}
          onClick={handleRestoreFromServer}
        >
          {restoring ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {t('settings.restoring')}
            </>
          ) : (
            <>
              <CloudDownload className="h-4 w-4 mr-2" />
              {t('settings.restoreFromServer')}
            </>
          )}
        </Button>
      </div>

      {settings.syncServiceType === 's3' && (
        <div className="space-y-2">
          <Label htmlFor="syncServiceBucket">{t('settings.bucket')}</Label>
          <Input
            id="syncServiceBucket"
            placeholder="my-bucket"
            value={settings.syncServiceBucket || ''}
            onChange={e => updateSetting('syncServiceBucket', e.target.value)}
          />
        </div>
      )}

      {settings.dataStorageMode === 'service' && (
        <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <Check className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{t('settings.serviceModeEnabled')}</span>
          </div>
          <p className="text-xs text-muted-foreground ml-6">
            {t('settings.serviceModeEnabledDesc')}
          </p>
        </div>
      )}
    </div>
  )
}
