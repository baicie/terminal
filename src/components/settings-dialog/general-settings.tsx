import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

interface GeneralSettingsProps {
  settings: {
    copyOnSelect: boolean
    pasteOnMiddleClick: boolean
    allowProposedApi: boolean
  }
  updateSetting: <K extends 'copyOnSelect' | 'pasteOnMiddleClick' | 'allowProposedApi'>(
    key: K,
    value: boolean,
  ) => void
}

export function GeneralSettings({ settings, updateSetting }: GeneralSettingsProps) {
  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="copyOnSelect">Copy on Select</Label>
          <p className="text-sm text-muted-foreground">
            Automatically copy selection to clipboard
          </p>
        </div>
        <Switch
          id="copyOnSelect"
          checked={settings.copyOnSelect}
          onCheckedChange={checked => updateSetting('copyOnSelect', checked)}
        />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="pasteOnMiddleClick">Paste on Middle Click</Label>
          <p className="text-sm text-muted-foreground">
            Paste clipboard content on middle mouse button click
          </p>
        </div>
        <Switch
          id="pasteOnMiddleClick"
          checked={settings.pasteOnMiddleClick}
          onCheckedChange={checked => updateSetting('pasteOnMiddleClick', checked)}
        />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="allowProposedApi">Allow Proposed API</Label>
          <p className="text-sm text-muted-foreground">
            Enable xterm.js proposed API features
          </p>
        </div>
        <Switch
          id="allowProposedApi"
          checked={settings.allowProposedApi}
          onCheckedChange={checked => updateSetting('allowProposedApi', checked)}
        />
      </div>
    </div>
  )
}
