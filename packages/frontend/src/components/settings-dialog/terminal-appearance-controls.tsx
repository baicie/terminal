import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type {
  DialogTerminalSettings,
  UpdateDialogTerminalSetting,
} from './terminal-settings-types'

export function TerminalAppearanceControls({
  settings,
  updateSetting,
}: {
  settings: DialogTerminalSettings
  updateSetting: UpdateDialogTerminalSetting
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="fontSize">Font Size</Label>
          <span className="text-sm text-muted-foreground tabular-nums">
            {settings.fontSize ?? 14}px
          </span>
        </div>
        <Input
          id="fontSize"
          type="range"
          min={8}
          max={32}
          value={settings.fontSize ?? 14}
          onChange={e => updateSetting('fontSize', Number(e.target.value))}
          className="w-full accent-primary"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="fontFamily">Font Family</Label>
        <Input
          id="fontFamily"
          value={settings.fontFamily ?? 'Menlo, Monaco, monospace'}
          onChange={e => updateSetting('fontFamily', e.target.value)}
          className="font-mono text-sm"
        />
      </div>
      <div className="space-y-2">
        <Label>Cursor Style</Label>
        <div className="flex gap-2">
          {(['block', 'underline', 'bar'] as const).map(value => (
            <Button
              key={value}
              variant={settings.cursorStyle === value ? 'default' : 'outline'}
              size="sm"
              onClick={() => updateSetting('cursorStyle', value)}
              className="flex-1"
            >
              {value[0].toUpperCase() + value.slice(1)}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="cursorBlink" className="cursor-pointer">
            Cursor Blink
          </Label>
          <p className="text-xs text-muted-foreground">
            Enable blinking cursor animation
          </p>
        </div>
        <Switch
          id="cursorBlink"
          checked={settings.cursorBlink ?? true}
          onCheckedChange={value => updateSetting('cursorBlink', value)}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="scrollback">Scrollback Lines</Label>
          <span className="text-sm text-muted-foreground tabular-nums">
            {(settings.scrollback ?? 10000).toLocaleString()}
          </span>
        </div>
        <Input
          id="scrollback"
          type="range"
          min={1000}
          max={100000}
          step={1000}
          value={settings.scrollback ?? 10000}
          onChange={e => updateSetting('scrollback', Number(e.target.value))}
          className="w-full accent-primary"
        />
      </div>
    </div>
  )
}
