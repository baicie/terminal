import { readTextFile } from '@tauri-apps/plugin-fs'
import {
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  HardDrive,
  Loader2,
  RefreshCw,
  Server,
  Upload,
} from 'lucide-react'
import { useState } from 'react'
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
import {
  storageHealthCheck,
  storageInit,
  storageUpload,
} from '@/service/storage'

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
}

export function StorageSettingsDialog({
  settings,
  updateSetting,
}: StorageSettingsDialogProps) {
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
        settings.syncServiceType,
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
        toast.success('Connection successful', {
          description: `Successfully connected to ${settings.syncServiceType} service`,
        })
      } else {
        setConnectionStatus('error')
        toast.error('Connection failed', {
          description: 'The service responded but is not healthy',
        })
      }
    } catch (error) {
      setConnectionStatus('error')
      toast.error('Connection failed', {
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
      const { exportDataToFile } = await import('@/service/sync')
      const exportData = await exportDataToFile()
      if (exportData) {
        const fileContent = await readTextFile(exportData)
        const result = await storageUpload('terminal-backup.json', fileContent)
        if (result.success) {
          toast.success('Sync successful', {
            description: 'Data has been uploaded to the storage service',
          })
        } else {
          toast.error('Sync failed', {
            description: result.message,
          })
        }
      }
    } catch (error) {
      toast.error('Sync failed', {
        description: String(error),
      })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-6 py-4">
      <div className="space-y-3">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <HardDrive className="h-4 w-4" />
          Storage Mode
        </h4>
        <p className="text-sm text-muted-foreground">
          Choose how your data is stored. Local mode keeps everything on this
          device. Service mode enables syncing across devices via a remote
          server.
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
              className={`h-6 w-6 ${
                settings.dataStorageMode === 'local'
                  ? 'text-primary'
                  : 'text-muted-foreground'
              }`}
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
              className={`h-6 w-6 ${
                settings.dataStorageMode === 'service'
                  ? 'text-primary'
                  : 'text-muted-foreground'
              }`}
            />
            <span className="text-sm font-medium">Service</span>
            <span className="text-xs text-muted-foreground">
              Sync via remote server
            </span>
          </button>
        </div>
      </div>

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
            {settings.syncServiceType === 's3' ? 'Access Key ID' : 'Username'}
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
              Testing...
            </>
          ) : connectionStatus === 'success' ? (
            <>
              <Check className="h-4 w-4 mr-2 text-green-500" />
              Connected
            </>
          ) : connectionStatus === 'error' ? (
            <>
              <AlertCircle className="h-4 w-4 mr-2 text-red-500" />
              Failed
            </>
          ) : (
            <>
              <Server className="h-4 w-4 mr-2" />
              Test Connection
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
              Syncing...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              Sync Now
            </>
          )}
        </Button>
      </div>

      {settings.syncServiceType === 's3' && (
        <div className="space-y-2">
          <Label htmlFor="syncServiceBucket">Bucket Name</Label>
          <Input
            id="syncServiceBucket"
            placeholder="my-bucket"
            value={settings.syncServiceBucket || ''}
            onChange={e =>
              updateSetting('syncServiceBucket', e.target.value)
            }
          />
        </div>
      )}

      {settings.dataStorageMode === 'service' && (
        <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <Check className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Service mode enabled</span>
          </div>
          <p className="text-xs text-muted-foreground ml-6">
            Your data will sync with the configured storage service. Click &quot;Test
            Connection&quot; first to verify the service is reachable.
          </p>
        </div>
      )}
    </div>
  )
}
