import type { AppSettings } from '@/service/database'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

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
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      {/* Font Settings */}
      <div className="bg-card rounded-lg border p-4 space-y-4">
        <h3 className="text-sm font-medium">{t('settings.font')}</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="fontSize">{t('settings.fontSize')}</Label>
            <Input
              id="fontSize"
              type="number"
              min={8}
              max={32}
              value={settings.fontSize}
              onChange={e =>
                onSettingChange(
                  'fontSize',
                  Number.parseInt(e.target.value) || 14,
                )
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fontFamily">{t('settings.fontFamily')}</Label>
            <Input
              id="fontFamily"
              value={settings.fontFamily}
              onChange={e => onSettingChange('fontFamily', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Cursor Settings */}
      <div className="bg-card rounded-lg border p-4 space-y-4">
        <h3 className="text-sm font-medium">{t('settings.cursor')}</h3>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cursorStyle">{t('settings.cursorStyle')}</Label>
            <Select
              value={settings.cursorStyle}
              onValueChange={value =>
                onSettingChange(
                  'cursorStyle',
                  value as 'block' | 'underline' | 'bar',
                )
              }
            >
              <SelectTrigger id="cursorStyle">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="block">{t('settings.blockCursor')}</SelectItem>
                <SelectItem value="underline">{t('settings.underlineCursor')}</SelectItem>
                <SelectItem value="bar">{t('settings.barCursor')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="cursorBlink">{t('settings.cursorBlink')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.cursorBlinkDesc')}
              </p>
            </div>
            <Switch
              id="cursorBlink"
              checked={settings.cursorBlink}
              onCheckedChange={checked =>
                onSettingChange('cursorBlink', checked)
              }
            />
          </div>
        </div>
      </div>

      {/* Scrollback */}
      <div className="bg-card rounded-lg border p-4 space-y-4">
        <h3 className="text-sm font-medium">{t('settings.scrollback')}</h3>
        <div className="space-y-2">
          <Label htmlFor="scrollback">{t('settings.scrollbackLines')}</Label>
          <Input
            id="scrollback"
            type="number"
            min={1000}
            max={100000}
            value={settings.scrollback}
            onChange={e =>
              onSettingChange(
                'scrollback',
                Number.parseInt(e.target.value) || 10000,
              )
            }
          />
          <p className="text-xs text-muted-foreground">
            {t('settings.scrollbackDesc')}
          </p>
        </div>
      </div>

      {/* Terminal Theme */}
      <div className="bg-card rounded-lg border p-4 space-y-4">
        <h3 className="text-sm font-medium">{t('settings.terminalTheme')}</h3>
        <div className="grid grid-cols-4 gap-2">
          {[
            { id: 'one-dark', name: 'One Dark', bg: '#282c34' },
            { id: 'monokai', name: 'Monokai', bg: '#272822' },
            { id: 'dracula', name: 'Dracula', bg: '#282a36' },
            { id: 'nord', name: 'Nord', bg: '#2e3440' },
            { id: 'catppuccin', name: 'Catppuccin', bg: '#1e1e28' },
            { id: 'github-dark', name: 'GitHub Dark', bg: '#0d1117' },
            { id: 'solarized-dark', name: 'Solarized', bg: '#002b36' },
            { id: 'solarized-light', name: 'Solarized Light', bg: '#fdf6e3' },
          ].map(theme => (
            <button
              key={theme.id}
              type="button"
              className={`
                flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all text-center
                ${
                  (settings.terminalTheme || 'one-dark') === theme.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }
              `}
              onClick={() =>
                onSettingChange(
                  'terminalTheme',
                  theme.id as typeof settings.terminalTheme,
                )
              }
            >
              <div className="w-full h-6 rounded" style={{ backgroundColor: theme.bg }} />
              <span className="text-xs font-medium">{theme.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
