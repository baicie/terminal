import type { AppSettings, TerminalThemePreset } from '@/service/database'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { getThemeColors } from '@/utils/terminal-themes'
import {
  Download,
  Eye,
  Moon,
  Sun,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// ─── Theme catalog ─────────────────────────────────────────────────────

const DARK_THEMES: { id: TerminalThemePreset; name: string }[] = [
  { id: 'one-dark', name: 'One Dark' },
  { id: 'monokai', name: 'Monokai' },
  { id: 'dracula', name: 'Dracula' },
  { id: 'nord', name: 'Nord' },
  { id: 'catppuccin', name: 'Catppuccin' },
  { id: 'github-dark', name: 'GitHub Dark' },
  { id: 'solarized-dark', name: 'Solarized Dark' },
  { id: 'gruvbox-dark', name: 'Gruvbox Dark' },
  { id: 'tokyo-night', name: 'Tokyo Night' },
  { id: 'night-owl', name: 'Night Owl' },
]

const LIGHT_THEMES: { id: TerminalThemePreset; name: string }[] = [
  { id: 'solarized-light', name: 'Solarized Light' },
  { id: 'github-light', name: 'GitHub Light' },
  { id: 'monokai-light', name: 'Monokai Light' },
  { id: 'one-light', name: 'One Light' },
  { id: 'dracula-pro-light', name: 'Dracula Light' },
  { id: 'papercolor-light', name: 'PaperColor Light' },
]

// ─── Canvas preview ────────────────────────────────────────────────────

const ThemePreviewMini: React.FC<{ themeId: TerminalThemePreset }> = ({ themeId }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = 120 * dpr
    canvas.height = 48 * dpr
    ctx.scale(dpr, dpr)

    const colors = getThemeColors(themeId)
    ctx.fillStyle = colors.background
    ctx.fillRect(0, 0, 120, 48)

    const lineHeight = 7
    const fontSize = 5.5
    ctx.font = `${fontSize}px monospace`
    ctx.textBaseline = 'top'

    const lines: Array<{ text: string; x: number; y: number; color: string }> = [
      { text: '❯ ls -la ~/projects', x: 4, y: 4, color: colors.foreground },
      { text: 'drwxr-xr-x  4 user  staff   128', x: 4, y: 4 + lineHeight, color: colors.foreground },
      { text: '-rw-r--r--  1 user  staff  4096', x: 4, y: 4 + lineHeight * 2, color: colors.foreground },
      { text: 'total 12', x: 4, y: 4 + lineHeight * 3, color: colors.cyan },
      { text: 'README.md', x: 4, y: 4 + lineHeight * 4, color: colors.blue },
    ]

    for (const line of lines) {
      ctx.fillStyle = line.color
      ctx.fillText(line.text, line.x, line.y)
    }

    // Cursor
    ctx.fillStyle = colors.cursor
    ctx.fillRect(4 + 4 * fontSize * 0.55, 4 + lineHeight * 5, fontSize * 0.55, fontSize + 1)
  }, [themeId])

  return (
    <canvas
      ref={canvasRef}
      className="w-[120px] h-[48px] rounded block"
      style={{ imageRendering: 'pixelated' }}
    />
  )
}

// ─── Component ─────────────────────────────────────────────────────────

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
  const [activeTab, setActiveTab] = useState<'dark' | 'light'>('dark')

  const activeTerminalTheme = activeTab === 'dark'
    ? (settings.terminalThemeDark ?? 'one-dark')
    : (settings.terminalThemeLight ?? 'solarized-light')

  const handleThemeSelect = useCallback(
    (id: TerminalThemePreset) => {
      if (activeTab === 'dark') {
        onSettingChange('terminalThemeDark', id)
      } else {
        onSettingChange('terminalThemeLight', id)
      }
    },
    [activeTab, onSettingChange],
  )

  const previewColors = useMemo(
    () => getThemeColors(activeTerminalTheme as TerminalThemePreset),
    [activeTerminalTheme],
  )

  const handleExportTheme = useCallback(() => {
    const data = getThemeColors(activeTerminalTheme as TerminalThemePreset)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `terminal-theme-${activeTerminalTheme}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [activeTerminalTheme])

  const handleImportTheme = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const parsed = JSON.parse(text)
        if (!parsed.background || !parsed.foreground || !parsed.cursor) {
          alert('Invalid theme file')
          return
        }
        if (activeTab === 'dark') {
          onSettingChange('terminalThemeDark', 'custom')
        } else {
          onSettingChange('terminalThemeLight', 'custom')
        }
      } catch {
        alert('Failed to parse theme file')
      }
    }
    input.click()
  }, [activeTab, onSettingChange])

  const previewFontSize = Math.max(11, (settings.fontSize ?? 14) - 1)

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-6">
        {/* ─── Live Preview ─────────────────────────────────────────── */}
        <div className="bg-card rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Eye className="h-4 w-4" />
              {t('settings.terminalTheme')}
            </h3>
            <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
              <button
                type="button"
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-all ${
                  activeTab === 'dark'
                    ? 'bg-background shadow-sm text-foreground border border-border/60'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setActiveTab('dark')}
              >
                <Moon className="h-3 w-3" />
                Dark
              </button>
              <button
                type="button"
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-all ${
                  activeTab === 'light'
                    ? 'bg-background shadow-sm text-foreground border border-border/60'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setActiveTab('light')}
              >
                <Sun className="h-3 w-3" />
                Light
              </button>
            </div>
          </div>

          {/* Terminal preview */}
          <div
            className="rounded-lg overflow-hidden border"
            style={{ backgroundColor: previewColors.background }}
          >
            <div
              className="px-3 py-2 font-mono leading-relaxed"
              style={{
                color: previewColors.foreground,
                fontFamily: settings.fontFamily,
                fontSize: previewFontSize,
              }}
            >
              <div className="flex items-center gap-1">
                <span style={{ color: previewColors.green }}>❯</span>
                <span> ls -la ~/projects</span>
              </div>
              <div>drwxr-xr-x  4 user  staff   128 May  3 13:00 .config/</div>
              <div>drwxr-xr-x  2 user  staff   256 May  3 13:00 projects/</div>
              <div style={{ color: previewColors.cyan }}>total 12</div>
              <div>
                <span style={{ color: previewColors.blue }}>README.md</span>
                <span style={{ color: previewColors.brightBlack }}>  4.1 KB</span>
              </div>
              <div className="flex items-center">
                <span style={{ color: previewColors.green }}>❯</span>
                <span className="ml-0.5 relative">
                  ssh server
                  <span
                    className="absolute left-0 top-0 h-full animate-pulse"
                    style={{ width: '2ch', backgroundColor: previewColors.cursor, opacity: 0.9 }}
                  />
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Theme: <span className="font-medium text-foreground capitalize">{activeTerminalTheme}</span>
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="flex items-center gap-1 hover:text-foreground underline-offset-2 hover:underline"
                onClick={handleExportTheme}
              >
                <Download className="h-3 w-3" />
                Export
              </button>
              <button
                type="button"
                className="flex items-center gap-1 hover:text-foreground underline-offset-2 hover:underline"
                onClick={handleImportTheme}
              >
                <Upload className="h-3 w-3" />
                Import
              </button>
            </div>
          </div>
        </div>

        {/* ─── Dark Themes ────────────────────────────────────────── */}
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Moon className="h-3 w-3" />
            Dark Mode Themes
          </p>
          <div className="grid grid-cols-5 gap-2">
            {DARK_THEMES.map(theme => (
              <Tooltip key={theme.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={`
                      flex flex-col items-center gap-1.5 p-2 rounded-lg border-2 transition-all text-center
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-ring
                      ${(settings.terminalThemeDark ?? 'one-dark') === theme.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'}
                    `}
                    onClick={() => handleThemeSelect(theme.id)}
                  >
                    <ThemePreviewMini themeId={theme.id} />
                    <span className="text-[10px] font-medium leading-tight">{theme.name}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="font-medium">{theme.name}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        {/* ─── Light Themes ──────────────────────────────────────── */}
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Sun className="h-3 w-3" />
            Light Mode Themes
          </p>
          <div className="grid grid-cols-5 gap-2">
            {LIGHT_THEMES.map(theme => (
              <Tooltip key={theme.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={`
                      flex flex-col items-center gap-1.5 p-2 rounded-lg border-2 transition-all text-center
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-ring
                      ${(settings.terminalThemeLight ?? 'solarized-light') === theme.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'}
                    `}
                    onClick={() => handleThemeSelect(theme.id)}
                  >
                    <ThemePreviewMini themeId={theme.id} />
                    <span className="text-[10px] font-medium leading-tight">{theme.name}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="font-medium">{theme.name}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        <Separator />

        {/* ─── Font & Cursor ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="text-sm font-medium">{t('settings.font')}</h3>
            <div className="space-y-2">
              <Label htmlFor="fontSize">{t('settings.fontSize')}</Label>
              <div className="flex items-center gap-3">
                <input
                  id="fontSize"
                  type="range"
                  min={8}
                  max={32}
                  value={settings.fontSize ?? 14}
                  onChange={e => onSettingChange('fontSize', Number(e.target.value))}
                  className="flex-1 accent-primary"
                />
                <span className="text-sm text-muted-foreground tabular-nums w-10 text-right">
                  {settings.fontSize ?? 14}px
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fontFamily">{t('settings.fontFamily')}</Label>
              <Input
                id="fontFamily"
                value={settings.fontFamily}
                onChange={e => onSettingChange('fontFamily', e.target.value)}
                className="font-mono text-sm"
              />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium">{t('settings.cursor')}</h3>
            <div className="space-y-2">
              <Label htmlFor="cursorStyle">{t('settings.cursorStyle')}</Label>
              <div className="flex gap-2">
                {(['block', 'underline', 'bar'] as const).map(v => (
                  <Button
                    key={v}
                    variant={settings.cursorStyle === v ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => onSettingChange('cursorStyle', v)}
                    className="flex-1"
                  >
                    {t(`settings.${v}Cursor`)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="cursorBlink" className="cursor-pointer">{t('settings.cursorBlink')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.cursorBlinkDesc')}</p>
              </div>
              <Switch
                id="cursorBlink"
                checked={settings.cursorBlink ?? true}
                onCheckedChange={v => onSettingChange('cursorBlink', v)}
              />
            </div>
          </div>
        </div>

        {/* Scrollback */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t('settings.scrollback')}</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="scrollback">{t('settings.scrollbackLines')}</Label>
              <span className="text-sm text-muted-foreground tabular-nums">
                {(settings.scrollback ?? 10000).toLocaleString()}
              </span>
            </div>
            <input
              id="scrollback"
              type="range"
              min={1000}
              max={100000}
              step={1000}
              value={settings.scrollback ?? 10000}
              onChange={e => onSettingChange('scrollback', Number(e.target.value))}
              className="w-full accent-primary"
            />
            <p className="text-xs text-muted-foreground">{t('settings.scrollbackDesc')}</p>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
