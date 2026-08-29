import {
  AlertCircle,
  Check,
  Cloud,
  CloudUpload,
  Loader2,
  Server,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RestorePreview } from '@/components/storage-restore-preview'
import type { SyncPreviewStats } from '@/hooks/use-storage-sync'

export function StorageSyncActions({
  t,
  endpoint,
  testingConnection,
  connectionStatus,
  syncing,
  restoring,
  lastSyncTime,
  restoreMode,
  onRestoreModeChange,
  onTestConnection,
  onSync,
  onPreview,
  onRestore,
  canPreview,
  isSyncDisabled,
  showRestore,
}: {
  t: (key: string) => string
  endpoint: string
  testingConnection: boolean
  connectionStatus: string
  syncing: boolean
  restoring: boolean
  lastSyncTime: string | null
  restoreMode: 'merge' | 'replace'
  onRestoreModeChange: (value: string) => void
  onTestConnection: () => void
  onSync: () => void
  onPreview: () => Promise<{
    success: boolean
    localCounts?: SyncPreviewStats
    remoteCounts?: SyncPreviewStats
    conflictCounts?: SyncPreviewStats
    error?: string
  }>
  onRestore: () => void
  canPreview: boolean
  isSyncDisabled: () => boolean
  showRestore: boolean
}) {
  return (
    <>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={!endpoint || testingConnection}
          onClick={onTestConnection}
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
          disabled={isSyncDisabled()}
          onClick={onSync}
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
      {showRestore && (
        <div className="space-y-3 p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2 text-sm">
            <Cloud className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              {t('settings.lastSync')}:
            </span>
            <span className="font-medium">
              {lastSyncTime || t('settings.never')}
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="text-xs shrink-0">
                {t('settings.restoreMode')}:
              </Label>
              <Select value={restoreMode} onValueChange={onRestoreModeChange}>
                <SelectTrigger className="h-7 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="merge">{t('settings.merge')}</SelectItem>
                  <SelectItem value="replace">
                    {t('settings.replace')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {restoreMode === 'merge'
                ? t('settings.mergeDesc')
                : t('settings.replaceDesc')}
            </p>
          </div>
          <RestorePreview
            onPreview={onPreview}
            restoreMode={restoreMode}
            canPreview={canPreview}
            onRestore={onRestore}
            isRestoring={restoring}
          />
        </div>
      )}
    </>
  )
}
