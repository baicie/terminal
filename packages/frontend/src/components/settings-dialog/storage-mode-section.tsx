import { HardDrive, Server } from 'lucide-react'
import type { TFunction } from 'i18next'
import { Button } from '@/components/ui/button'
import type {
  StorageSettings,
  UpdateStorageSetting,
} from './storage-settings-types'

export function StorageModeSection({
  settings,
  updateSetting,
  t,
}: {
  settings: StorageSettings
  updateSetting: UpdateStorageSetting
  t: TFunction
}) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium flex items-center gap-2">
        <HardDrive className="h-4 w-4" />
        {t('settings.storageMode')}
      </h4>
      <p className="text-sm text-muted-foreground">
        {t('settings.storageModeDesc')}
      </p>
      <div className="grid grid-cols-2 gap-3">
        {(['local', 'service'] as const).map(mode => {
          const active = settings.dataStorageMode === mode
          const Icon = mode === 'local' ? HardDrive : Server
          return (
            <Button
              type="button"
              variant="outline"
              key={mode}
              className={`h-auto flex flex-col items-center gap-2 p-4 border-2 text-center ${active ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
              onClick={() => updateSetting('dataStorageMode', mode)}
            >
              <Icon
                className={`h-6 w-6 ${active ? 'text-primary' : 'text-muted-foreground'}`}
              />
              <span className="text-sm font-medium">
                {t(`settings.${mode}`)}
              </span>
              <span className="text-xs text-muted-foreground">
                {t(`settings.${mode}Desc`)}
              </span>
            </Button>
          )
        })}
      </div>
    </div>
  )
}
