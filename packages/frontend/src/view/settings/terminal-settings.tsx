import type { AppSettings } from '@/service/database'
import { Separator } from '@/components/ui/separator'
import { TerminalAppearanceControls } from '@/components/settings-dialog/terminal-appearance-controls'
import { TerminalThemePanel } from '@/components/settings-dialog/terminal-theme-panel'
import type {
  DialogTerminalSettings,
  UpdateDialogTerminalSetting,
} from '@/components/settings-dialog/terminal-settings-types'

interface TerminalSettingsProps {
  settings: AppSettings
  onSettingChange: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => void
}

export const TerminalSettings: React.FC<TerminalSettingsProps> = ({
  settings,
  onSettingChange,
}) => {
  const updateSetting: UpdateDialogTerminalSetting = (key, value) => {
    if (key === 'customTerminalTheme') return
    onSettingChange(key as never, value as never)
  }
  return (
    <div className="space-y-6">
      <TerminalThemePanel
        settings={settings as DialogTerminalSettings}
        updateSetting={updateSetting}
      />
      <Separator />
      <TerminalAppearanceControls
        settings={settings}
        updateSetting={updateSetting}
      />
    </div>
  )
}
