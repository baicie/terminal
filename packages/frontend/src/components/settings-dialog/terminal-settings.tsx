import { Separator } from '@/components/ui/separator'
import { TerminalAppearanceControls } from './terminal-appearance-controls'
import { TerminalThemePanel } from './terminal-theme-panel'
import type {
  DialogTerminalSettings,
  UpdateDialogTerminalSetting,
} from './terminal-settings-types'

export interface TerminalSettingsProps {
  settings: DialogTerminalSettings
  updateSetting: UpdateDialogTerminalSetting
}

export function TerminalSettings({
  settings,
  updateSetting,
}: TerminalSettingsProps) {
  return (
    <div className="space-y-6">
      <TerminalThemePanel settings={settings} updateSetting={updateSetting} />
      <Separator />
      <TerminalAppearanceControls
        settings={settings}
        updateSetting={updateSetting}
      />
    </div>
  )
}
