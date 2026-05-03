import type { TerminalThemePreset } from '@/service/database'
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
import type { TerminalThemeColors } from '@/service/database'

// ─── Theme catalog ─────────────────────────────────────────────────────

const DARK_THEMES: { id: TerminalThemePreset; name: string; bg: string; text: string; accent: string }[] = [
  { id: 'one-dark', name: 'One Dark', bg: '#282c34', text: '#abb2bf', accent: '#61afef' },
  { id: 'monokai', name: 'Monokai', bg: '#272822', text: '#f8f8f2', accent: '#66d9ef' },
  { id: 'dracula', name: 'Dracula', bg: '#282a36', text: '#f8f8f2', accent: '#bd93f9' },
  { id: 'nord', name: 'Nord', bg: '#2e3440', text: '#d8dee9', accent: '#88c0d0' },
  { id: 'catppuccin', name: 'Catppuccin', bg: '#1e1e28', text: '#cdd6f4', accent: '#cba6f7' },
  { id: 'github-dark', name: 'GitHub Dark', bg: '#0d1117', text: '#e6edf3', accent: '#58a6ff' },
  { id: 'solarized-dark', name: 'Solarized Dark', bg: '#002b36', text: '#839496', accent: '#268bd2' },
  { id: 'gruvbox-dark', name: 'Gruvbox Dark', bg: '#282828', text: '#ebdbb2', accent: '#fabd2f' },
  { id: 'tokyo-night', name: 'Tokyo Night', bg: '#1a1b26', text: '#a9b1d6', accent: '#7aa2f7' },
  { id: 'night-owl', name: 'Night Owl', bg: '#011627', text: '#d6deeb', accent: '#82aaff' },
]

const LIGHT_THEMES: { id: TerminalThemePreset; name: string; bg: string; text: string; accent: string }[] = [
  { id: 'solarized-light', name: 'Solarized Light', bg: '#fdf6e3', text: '#657b83', accent: '#268bd2' },
  { id: 'github-light', name: 'GitHub Light', bg: '#ffffff', text: '#24292f', accent: '#0969da' },
  { id: 'monokai-light', name: 'Monokai Light', bg: '#fefcf4', text: '#49483e', accent: '#66d9ef' },
  { id: 'one-light', name: 'One Light', bg: '#fafafa', text: '#383a42', accent: '#4078f2' },
  { id: 'dracula-pro-light', name: 'Dracula Light', bg: '#faf9f7', text: '#5c5c5c', accent: '#bd93f9' },
  { id: 'papercolor-light', name: 'PaperColor Light', bg: '#eeeeee', text: '#444444', accent: '#008b8b' },
]

// ─── Mini canvas preview ────────────────────────────────────────────────

interface ThemePreviewProps {
  themeId: TerminalThemePreset
}

const ThemePreview: React.FC<ThemePreviewProps> = ({ themeId }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = 120 * dpr
    canvas.height = 52 * dpr
    ctx.scale(dpr, dpr)

    const colors = getThemeColors(themeId)
    ctx.fillStyle = colors.background
    ctx.fillRect(0, 0, 120, 52)

    const lineHeight = 7
    const fontSize = 5.5
    ctx.font = `${fontSize}px monospace`
    ctx.textBaseline = 'top'

    const lines: Array<{ text: string; x: number; y: number; color: string }> = [
      { text: '❯', x: 4, y: 4, color: colors.green },
      { text: ' ls -la /home', x: 14, y: 4, color: colors.foreground },
      { text: 'drwxr-xr-x  4 user  staff   128 May  3 13:00 .config', x: 4, y: 4 + lineHeight, color: colors.foreground },
      { text: 'drwxr-xr-x  2 user  staff   256 May  3 13:00 projects', x: 4, y: 4 + lineHeight * 2, color: colors.foreground },
      { text: '-rw-r--r--  1 user  staff  4096 May  3 13:00 README.md', x: 4, y: 4 + lineHeight * 3, color: colors.foreground },
      { text: 'total 12', x: 4, y: 4 + lineHeight * 4, color: colors.cyan },
      { text: 'README.md', x: 4, y: 4 + lineHeight * 5, color: colors.blue },
    ]

    for (const line of lines) {
      ctx.fillStyle = line.color
      ctx.fillText(line.text, line.x, line.y)
    }

    // Cursor (blinking effect simulated)
    ctx.fillStyle = colors.cursor
    ctx.fillRect(4 + 12 * fontSize * 0.55, 4, fontSize * 0.55, fontSize + 1)
  }, [themeId])

  return (
    <canvas
      ref={canvasRef}
      className="w-[120px] h-[52px] rounded block"
      style={{ imageRendering: 'pixelated' }}
    />
  )
}

// ─── Props ─────────────────────────────────────────────────────────────

interface TerminalSettingsProps {
  settings: {
    fontSize?: number
    fontFamily?: string
    cursorStyle?: 'block' | 'underline' | 'bar'
    cursorBlink?: boolean
    scrollback?: number
    terminalThemeDark?: TerminalThemePreset
    terminalThemeLight?: TerminalThemePreset
    customTerminalTheme?: TerminalThemeColors
  }
  updateSetting: <K extends keyof NonNullable<TerminalSettingsProps['settings']>>(
    key: K,
    value: NonNullable<TerminalSettingsProps['settings']>[K],
  ) => void
}

type CursorStyle = 'block' | 'underline' | 'bar'

const CURSOR_STYLES: { value: CursorStyle; label: string }[] = [
  { value: 'block', label: 'Block' },
  { value: 'underline', label: 'Underline' },
  { value: 'bar', label: 'Bar' },
]

// ─── Component ─────────────────────────────────────────────────────────

export function TerminalSettings({
  settings,
  updateSetting,
}: TerminalSettingsProps) {
  const [activeTab, setActiveTab] = useState<'dark' | 'light'>('dark')

  const activeTerminalTheme = activeTab === 'dark'
    ? (settings.terminalThemeDark ?? 'one-dark')
    : (settings.terminalThemeLight ?? 'solarized-light')

  const handleThemeSelect = useCallback(
    (id: TerminalThemePreset) => {
      if (activeTab === 'dark') {
        updateSetting('terminalThemeDark', id)
      } else {
        updateSetting('terminalThemeLight', id)
      }
    },
    [activeTab, updateSetting],
  )

  const previewColors = useMemo(() => {
    if (activeTerminalTheme === 'custom' && settings.customTerminalTheme) {
      return settings.customTerminalTheme
    }
    return getThemeColors(activeTerminalTheme as TerminalThemePreset)
  }, [activeTerminalTheme, settings.customTerminalTheme])

  const handleExportTheme = useCallback(() => {
    const themeId = activeTerminalTheme
    const data = themeId === 'custom' && settings.customTerminalTheme
      ? settings.customTerminalTheme
      : getThemeColors(themeId as TerminalThemePreset)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `terminal-theme-${themeId}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [activeTerminalTheme, settings.customTerminalTheme])

  const handleImportTheme = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const parsed = JSON.parse(text) as TerminalThemeColors
        if (!parsed.background || !parsed.foreground || !parsed.cursor) {
          alert('Invalid theme file: missing required color fields (background, foreground, cursor)')
          return
        }
        updateSetting('customTerminalTheme', parsed)
        if (activeTab === 'dark') {
          updateSetting('terminalThemeDark', 'custom')
        } else {
          updateSetting('terminalThemeLight', 'custom')
        }
      } catch {
        alert('Failed to parse theme file')
      }
    }
    input.click()
  }, [activeTab, updateSetting])

  const previewFontSize = Math.max(11, (settings.fontSize ?? 14) - 1)

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-6">
        {/* ─── Live Preview ─────────────────────────────────────────── */}
        <div className="bg-card rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Live Preview
            </h4>

            {/* Dark / Light tab switcher */}
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

          {/* Preview terminal */}
          <div
            className="rounded-lg overflow-hidden border"
            style={{ backgroundColor: previewColors.background }}
          >
            <div
              className="px-3 py-2 font-mono leading-relaxed"
              style={{
                color: previewColors.foreground,
                fontFamily: settings.fontFamily ?? 'Menlo, Monaco, monospace',
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
                <span style={{ color: previewColors.brightGreen }}> ✓</span>
              </div>
              <div className="flex items-center">
                <span style={{ color: previewColors.green }}>❯</span>
                <span className="ml-0.5 relative">
                  ssh server
                  <span
                    className="absolute left-0 top-0 h-full animate-pulse"
                    style={{
                      width: '2ch',
                      backgroundColor: previewColors.cursor,
                      opacity: 0.9,
                    }}
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

        {/* ─── Dark Themes ───────────────────────────────────────────── */}
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
                    <ThemePreview themeId={theme.id} />
                    <span className="text-[10px] font-medium leading-tight">{theme.name}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="font-medium">{theme.name}</p>
                  <p className="text-xs text-muted-foreground/80">Click to apply</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        {/* ─── Light Themes ─────────────────────────────────────────── */}
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
                    <ThemePreview themeId={theme.id} />
                    <span className="text-[10px] font-medium leading-tight">{theme.name}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="font-medium">{theme.name}</p>
                  <p className="text-xs text-muted-foreground/80">Click to apply</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        <Separator />

        {/* ─── Font & Cursor ─────────────────────────────────────────── */}
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="fontSize">Font Size</Label>
              <span className="text-sm text-muted-foreground tabular-nums">{settings.fontSize ?? 14}px</span>
            </div>
            <input
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
              {CURSOR_STYLES.map(opt => (
                <Button
                  key={opt.value}
                  variant={settings.cursorStyle === opt.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => updateSetting('cursorStyle', opt.value)}
                  className="flex-1"
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="cursorBlink" className="cursor-pointer">Cursor Blink</Label>
              <p className="text-xs text-muted-foreground">Enable blinking cursor animation</p>
            </div>
            <Switch
              id="cursorBlink"
              checked={settings.cursorBlink ?? true}
              onCheckedChange={v => updateSetting('cursorBlink', v)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="scrollback">Scrollback Lines</Label>
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
              onChange={e => updateSetting('scrollback', Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
