import type { TerminalThemePreset } from '@/service/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

interface TerminalSettingsProps {
  settings: {
    fontSize?: number
    fontFamily?: string
    cursorStyle?: 'block' | 'underline' | 'bar'
    cursorBlink?: boolean
    scrollback?: number
    terminalThemeDark?: TerminalThemePreset
    terminalThemeLight?: TerminalThemePreset
  }
  updateSetting: <K extends keyof NonNullable<TerminalSettingsProps['settings']>>(
    key: K,
    value: NonNullable<TerminalSettingsProps['settings']>[K],
  ) => void
}

export function TerminalSettings({
  settings,
  updateSetting,
}: TerminalSettingsProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="fontSize">Font Size</Label>
        <Input
          id="fontSize"
          type="number"
          min={8}
          max={32}
          value={settings.fontSize}
          onChange={e =>
            updateSetting(
              'fontSize',
              Number.parseInt(e.target.value) || 14,
            )
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="fontFamily">Font Family</Label>
        <Input
          id="fontFamily"
          value={settings.fontFamily}
          onChange={e => updateSetting('fontFamily', e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="cursorStyle">Cursor Style</Label>
        <Select
          value={settings.cursorStyle}
          onValueChange={value =>
            updateSetting(
              'cursorStyle',
              value as 'block' | 'underline' | 'bar',
            )
          }
        >
          <SelectTrigger id="cursorStyle">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="block">Block</SelectItem>
            <SelectItem value="underline">Underline</SelectItem>
            <SelectItem value="bar">Bar</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="cursorBlink">Cursor Blink</Label>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            updateSetting('cursorBlink', !settings.cursorBlink)
          }
        >
          {settings.cursorBlink ? 'On' : 'Off'}
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="scrollback">Scrollback Lines</Label>
        <Input
          id="scrollback"
          type="number"
          min={1000}
          max={100000}
          value={settings.scrollback}
          onChange={e =>
            updateSetting(
              'scrollback',
              Number.parseInt(e.target.value) || 10000,
            )
          }
        />
      </div>

      <Separator />

      <div className="space-y-3">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <span className="text-muted-foreground">Terminal Theme</span>
        </h4>
        <p className="text-sm text-muted-foreground">
          Choose color themes for light and dark app modes.
        </p>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Dark Mode
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'one-dark', name: 'One Dark', bg: '#282c34' },
                { id: 'monokai', name: 'Monokai', bg: '#272822' },
                { id: 'dracula', name: 'Dracula', bg: '#282a36' },
                { id: 'nord', name: 'Nord', bg: '#2e3440' },
                { id: 'catppuccin', name: 'Catppuccin', bg: '#1e1e28' },
                { id: 'github-dark', name: 'GitHub Dark', bg: '#0d1117' },
                { id: 'solarized-dark', name: 'Solarized', bg: '#002b36' },
              ].map(theme => (
                <button
                  key={theme.id}
                  type="button"
                  className={`
                    flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all text-center
                    ${
                      (settings.terminalThemeDark || 'one-dark') === theme.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }
                  `}
                  onClick={() =>
                    updateSetting(
                      'terminalThemeDark',
                      theme.id as typeof settings.terminalThemeDark,
                    )
                  }
                >
                  <div
                    className="w-full h-6 rounded"
                    style={{ backgroundColor: theme.bg }}
                  />
                  <span className="text-xs font-medium">{theme.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Light Mode
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  id: 'solarized-light',
                  name: 'Solarized Light',
                  bg: '#fdf6e3',
                },
                {
                  id: 'github-dark',
                  name: 'GitHub Dark',
                  bg: '#0d1117',
                },
              ].map(theme => (
                <button
                  key={theme.id}
                  type="button"
                  className={`
                    flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all text-center
                    ${
                      (settings.terminalThemeLight || 'solarized-light') ===
                      theme.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }
                  `}
                  onClick={() =>
                    updateSetting(
                      'terminalThemeLight',
                      theme.id as typeof settings.terminalThemeLight,
                    )
                  }
                >
                  <div
                    className="w-full h-6 rounded"
                    style={{ backgroundColor: theme.bg }}
                  />
                  <span className="text-xs font-medium">{theme.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
