import type { TerminalThemePreset } from '@/service/database'

interface Options {
  appTheme: string
  dark: TerminalThemePreset
  light: TerminalThemePreset
}

/**
 * Pick the light or dark terminal preset, following an explicit app theme and
 * otherwise deferring to the system preference, so the terminal never keeps a
 * second source of truth for which appearance is active.
 */
export function useTerminalActivePreset(options: Options): TerminalThemePreset {
  if (options.appTheme === 'light') return options.light
  if (options.appTheme === 'dark') return options.dark
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? options.dark
    : options.light
}
