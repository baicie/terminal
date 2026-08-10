import type { TFunction } from 'i18next'
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
import type { useStorageSync } from '@/hooks/use-storage-sync'

interface StorageSyncPanelProps {
  endpoint: string
  restoreMode: 'merge' | 'replace'
  onRestoreModeChange: (mode: 'merge' | 'replace') => void
  onTest: () => void
  onSync: () => void
  onRestore: () => void
  onPreview: ReturnType<typeof useStorageSync>['handlePreviewServerData']
  onOpenTeams: () => void
  sync: ReturnType<typeof useStorageSync>
  t: TFunction<'settings'>
}

export function StorageSyncPanel({
  endpoint,
  restoreMode,
  onRestoreModeChange,
  onTest,
  onSync,
  onRestore,
  onPreview,
  onOpenTeams,
  sync,
  t,
}: StorageSyncPanelProps) {
  return (
    <>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={!endpoint || sync.testingConnection}
          onClick={onTest}
        >
          <ConnectionButtonContent sync={sync} t={t} />
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          disabled={sync.isSyncDisabled()}
          onClick={onSync}
        >
          {sync.syncing ? (
            <>
              <Loader2 className="animate-spin" />
              {t('settings.syncing')}
            </>
          ) : (
            <>
              <CloudUpload />
              {t('settings.syncNow')}
            </>
          )}
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3">
        <div className="flex items-center gap-2 text-sm">
          <Cloud className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">
            {t('settings.lastSync')}:
          </span>
          <span className="font-medium">
            {sync.lastSyncTime || t('settings.never')}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Label className="shrink-0 text-xs">
              {t('settings.restoreMode')}:
            </Label>
            <Select
              value={restoreMode}
              onValueChange={value =>
                onRestoreModeChange(value as 'merge' | 'replace')
              }
            >
              <SelectTrigger className="h-7 flex-1 text-xs">
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

        <RestorePreview
          onPreview={onPreview}
          restoreMode={restoreMode}
          canPreview={sync.connectionStatus === 'success' && !!endpoint}
          onRestore={onRestore}
          isRestoring={sync.restoring}
        />

        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto w-fit p-0 text-xs text-muted-foreground"
          onClick={onOpenTeams}
        >
          {t('openTeams')}
        </Button>
      </div>
    </>
  )
}

function ConnectionButtonContent({
  sync,
  t,
}: Pick<StorageSyncPanelProps, 'sync' | 't'>) {
  if (sync.testingConnection) {
    return (
      <>
        <Loader2 className="animate-spin" />
        {t('settings.testing')}
      </>
    )
  }
  if (sync.connectionStatus === 'success') {
    return (
      <>
        <Check className="text-green-500" />
        {t('settings.connected')}
      </>
    )
  }
  if (sync.connectionStatus === 'error') {
    return (
      <>
        <AlertCircle className="text-red-500" />
        {t('settings.failed')}
      </>
    )
  }
  return (
    <>
      <Server />
      {t('settings.testConnection')}
    </>
  )
}
