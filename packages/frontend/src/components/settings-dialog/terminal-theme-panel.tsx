import type { TerminalThemePreset } from '@/service/database'
import { Download, Eye, Moon, Sun, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getThemeColors } from '@/utils/terminal-themes'
import { TerminalThemeGrid } from './terminal-theme-grid'
import type {
  DialogTerminalSettings,
  UpdateDialogTerminalSetting,
} from './terminal-settings-types'

const darkThemes = [
  'one-dark',
  'monokai',
  'dracula',
  'nord',
  'catppuccin',
  'github-dark',
  'solarized-dark',
  'gruvbox-dark',
  'tokyo-night',
  'night-owl',
] as const
const lightThemes = [
  'solarized-light',
  'github-light',
  'monokai-light',
  'one-light',
  'dracula-pro-light',
  'papercolor-light',
] as const
export function TerminalThemePanel({
  settings,
  updateSetting,
}: {
  settings: DialogTerminalSettings
  updateSetting: UpdateDialogTerminalSetting
}) {
  const [activeTab, setActiveTab] = useState<'dark' | 'light'>('dark')
  const activeTheme =
    activeTab === 'dark'
      ? (settings.terminalThemeDark ?? 'one-dark')
      : (settings.terminalThemeLight ?? 'solarized-light')
  const colors = useMemo(
    () =>
      activeTheme === 'custom' && settings.customTerminalTheme
        ? settings.customTerminalTheme
        : getThemeColors(activeTheme),
    [activeTheme, settings.customTerminalTheme],
  )
  const selectTheme = (theme: TerminalThemePreset) =>
    updateSetting(
      activeTab === 'dark' ? 'terminalThemeDark' : 'terminalThemeLight',
      theme,
    )
  const exportTheme = () => {
    const data =
      activeTheme === 'custom' && settings.customTerminalTheme
        ? settings.customTerminalTheme
        : getThemeColors(activeTheme)
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `terminal-theme-${activeTheme}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  const importTheme = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const theme = JSON.parse(await file.text())
        if (!theme.background || !theme.foreground || !theme.cursor) {
          alert(
            'Invalid theme file: missing required color fields (background, foreground, cursor)',
          )
          return
        }
        updateSetting('customTerminalTheme', theme)
        selectTheme('custom')
      } catch {
        alert('Failed to parse theme file')
      }
    }
    input.click()
  }
  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-6">
        <div className="bg-card rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Live Preview
            </h4>
            <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
              <Button
                variant={activeTab === 'dark' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('dark')}
              >
                <Moon />
                Dark
              </Button>
              <Button
                variant={activeTab === 'light' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('light')}
              >
                <Sun />
                Light
              </Button>
            </div>
          </div>
          <div
            className="rounded-lg overflow-hidden border"
            style={{ backgroundColor: colors.background }}
          >
            <div
              className="px-3 py-2 font-mono leading-relaxed"
              style={{
                color: colors.foreground,
                fontFamily: settings.fontFamily ?? 'Menlo, Monaco, monospace',
                fontSize: Math.max(11, (settings.fontSize ?? 14) - 1),
              }}
            >
              <div>
                <span style={{ color: colors.green }}>❯</span> ls -la ~/projects
              </div>
              <div>drwxr-xr-x 4 user staff 128 May 3 13:00 .config/</div>
              <div style={{ color: colors.cyan }}>total 12</div>
              <div>
                <span style={{ color: colors.blue }}>README.md</span>
                <span style={{ color: colors.brightBlack }}> 4.1 KB</span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Theme:{' '}
              <span className="font-medium text-foreground capitalize">
                {activeTheme}
              </span>
            </span>
            <div className="flex items-center gap-3">
              <Button variant="link" size="sm" onClick={exportTheme}>
                <Download />
                Export
              </Button>
              <Button variant="link" size="sm" onClick={importTheme}>
                <Upload />
                Import
              </Button>
            </div>
          </div>
        </div>
        <TerminalThemeGrid
          themes={darkThemes}
          selected={settings.terminalThemeDark ?? 'one-dark'}
          title="Dark Mode Themes"
          icon={Moon}
          onSelect={selectTheme}
        />
        <TerminalThemeGrid
          themes={lightThemes}
          selected={settings.terminalThemeLight ?? 'solarized-light'}
          title="Light Mode Themes"
          icon={Sun}
          onSelect={selectTheme}
        />
      </div>
    </TooltipProvider>
  )
}
