import type { TFunction } from 'i18next'
import { HardDrive, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AppSettings } from '@/service/database'
import { cn } from '@/lib/utils'

interface StorageModePanelProps {
  settings: AppSettings
  onSettingChange: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => void
  t: TFunction<'settings'>
}

export function StorageModePanel({
  settings,
  onSettingChange,
  t,
}: StorageModePanelProps) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <HardDrive className="size-4" />
        {t('settings.storageMode')}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t('settings.storageModeDesc')}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <StorageModeButton
          active={settings.dataStorageMode === 'local'}
          icon={HardDrive}
          label={t('settings.local')}
          description={t('settings.localDesc')}
          onClick={() => onSettingChange('dataStorageMode', 'local')}
        />
        <StorageModeButton
          active={settings.dataStorageMode === 'service'}
          icon={Server}
          label={t('settings.service')}
          description={t('settings.serviceDesc')}
          onClick={() => onSettingChange('dataStorageMode', 'service')}
        />
      </div>
    </div>
  )
}

interface StorageModeButtonProps {
  active: boolean
  icon: typeof HardDrive
  label: string
  description: string
  onClick: () => void
}

function StorageModeButton({
  active,
  icon: Icon,
  label,
  description,
  onClick,
}: StorageModeButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(
        'h-auto flex-col gap-2 rounded-lg border-2 p-4 text-center',
        active
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/50',
      )}
      onClick={onClick}
    >
      <Icon
        className={cn(
          'size-6',
          active ? 'text-primary' : 'text-muted-foreground',
        )}
      />
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </Button>
  )
}
