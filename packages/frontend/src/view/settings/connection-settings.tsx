import type { AppSettings } from '@/service/database'
import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

interface ConnectionSettingsProps {
  settings: AppSettings
  onSettingChange: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => void
}

export const ConnectionSettings: React.FC<ConnectionSettingsProps> = ({
  settings,
  onSettingChange,
}) => {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      {/* Selection Settings */}
      <div className="bg-card rounded-lg border p-4 space-y-4">
        <h3 className="text-sm font-medium">{t('settings.selection')}</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="copyOnSelect">{t('settings.copyOnSelect')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.copyOnSelectDesc')}
              </p>
            </div>
            <Switch
              id="copyOnSelect"
              checked={settings.copyOnSelect}
              onCheckedChange={checked =>
                onSettingChange('copyOnSelect', checked)
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="pasteOnMiddleClick">
                {t('settings.pasteOnMiddleClick')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.pasteOnMiddleClickDesc')}
              </p>
            </div>
            <Switch
              id="pasteOnMiddleClick"
              checked={settings.pasteOnMiddleClick}
              onCheckedChange={checked =>
                onSettingChange('pasteOnMiddleClick', checked)
              }
            />
          </div>
        </div>
      </div>

      {/* Advanced Settings */}
      <div className="bg-card rounded-lg border p-4 space-y-4">
        <h3 className="text-sm font-medium">{t('settings.advanced')}</h3>
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="allowProposedApi">{t('settings.allowProposedApi')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('settings.allowProposedApiDesc')}
            </p>
          </div>
          <Switch
            id="allowProposedApi"
            checked={settings.allowProposedApi}
            onCheckedChange={checked =>
              onSettingChange('allowProposedApi', checked)
            }
          />
        </div>
      </div>
    </div>
  )
}
