import type { AppSettings } from '@/service/database'
import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface AppearanceSettingsProps {
  settings: AppSettings
  onSettingChange: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => void
}

export const AppearanceSettings: React.FC<AppearanceSettingsProps> = ({
  settings,
  onSettingChange,
}) => {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      {/* Theme */}
      <div className="bg-card rounded-lg border p-4 space-y-4">
        <h3 className="text-sm font-medium">{t('settings.theme')}</h3>
        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            className={`
              flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all text-center
              ${
                settings.theme === 'light'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }
            `}
            onClick={() => onSettingChange('theme', 'light')}
          >
            <div className="w-full h-8 rounded bg-white border" />
            <span className="text-sm font-medium">{t('settings.light')}</span>
          </button>

          <button
            type="button"
            className={`
              flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all text-center
              ${
                settings.theme === 'dark'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }
            `}
            onClick={() => onSettingChange('theme', 'dark')}
          >
            <div className="w-full h-8 rounded bg-zinc-900 border border-zinc-700" />
            <span className="text-sm font-medium">{t('settings.dark')}</span>
          </button>

          <button
            type="button"
            className={`
              flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all text-center
              ${
                settings.theme === 'system'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }
            `}
            onClick={() => onSettingChange('theme', 'system')}
          >
            <div className="w-full h-8 rounded bg-gradient-to-r from-white to-zinc-900 border" />
            <span className="text-sm font-medium">{t('settings.system')}</span>
          </button>
        </div>
      </div>

      {/* Language */}
      <div className="bg-card rounded-lg border p-4 space-y-4">
        <h3 className="text-sm font-medium">{t('settings.language')}</h3>
        <Select
          value={settings.language}
          onValueChange={(value: string) => onSettingChange('language', value)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">{t('settings.english')}</SelectItem>
            <SelectItem value="cn">{t('settings.chinese')}</SelectItem>
            <SelectItem value="fr">{t('settings.french')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
