import type {
  TerminalThemeColors,
  TerminalThemePreset,
} from '@/service/database'

export type DialogTerminalSettings = {
  fontSize?: number
  fontFamily?: string
  cursorStyle?: 'block' | 'underline' | 'bar'
  cursorBlink?: boolean
  scrollback?: number
  terminalThemeDark?: TerminalThemePreset
  terminalThemeLight?: TerminalThemePreset
  customTerminalTheme?: TerminalThemeColors
}
export type UpdateDialogTerminalSetting = <
  K extends keyof DialogTerminalSettings,
>(
  key: K,
  value: DialogTerminalSettings[K],
) => void
