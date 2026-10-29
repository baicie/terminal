/**
 * Terminal Settings Types
 * Re-exports theme utilities from the canonical location.
 * Theme color definitions live in @/utils/terminal-themes.ts
 */

import type { TerminalThemePreset } from '@/service/database'

// Re-export theme types and utilities from canonical location
export {
  terminalThemes,
  themeDisplayNames,
  getThemeColors,
  themeToXtermOptions,
} from '@/utils/terminal-themes'
export type { TerminalThemeColors } from '@/service/database'

/** Cursor style options */
export type CursorStyle = 'block' | 'underline' | 'bar'

/** Terminal settings interface */
export interface TerminalSettings {
  fontSize: number
  fontFamily: string
  cursorStyle: CursorStyle
  cursorBlink: boolean
  scrollback: number
  theme: TerminalThemePreset
}

/** Default terminal settings */
export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Monaco, Consolas, monospace",
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 1000,
  theme: 'one-dark',
}
