import { describe, expect, it } from 'vitest'
import {
  darkThemes,
  lightThemes,
} from '@/components/settings-dialog/terminal-theme-panel'
import type {
  TerminalThemeColors,
  TerminalThemePreset,
} from '@/service/database/types'
import {
  getThemeColors,
  terminalThemes,
  themeDisplayNames,
} from './terminal-themes'

const COLOR_KEYS = [
  'background',
  'foreground',
  'cursor',
  'cursorAccent',
  'selectionBackground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const

type ColorKey = (typeof COLOR_KEYS)[number]

const ANSI_KEYS = COLOR_KEYS.slice(5)

// Hex is case-insensitive, and several shipped presets use upper case.
const HEX_COLOR = /^#[0-9a-f]{6}$/i

const presetIds = Object.keys(terminalThemes) as TerminalThemePreset[]

const NEW_DARK_PRESETS = [
  'rose-pine',
  'kanagawa',
  'everforest-dark',
  'ayu-dark',
  'catppuccin-macchiato',
  'tokyo-night-storm',
] as const

const NEW_LIGHT_PRESETS = [
  'catppuccin-latte',
  'rose-pine-dawn',
  'ayu-light',
  'tokyo-night-light',
] as const

// `custom` holds whatever the user imported, so it has no palette row of its
// own in the settings grids.
const UNGROUPED_PRESETS: TerminalThemePreset[] = ['custom']

// Palettes that shipped before this batch are frozen by contract: their ids and
// values must not change. The keys that already sit under the contrast floors
// are therefore pinned to their shipped value instead of being edited, which
// keeps the floors strict for every other color and turns any later retint of
// these keys into a failing test.
const FROZEN_BELOW_FLOOR: Record<string, string> = {
  'monokai.black': '#272822',
  'solarized-dark.black': '#073642',
  'solarized-light.foreground': '#657b83',
  'solarized-light.white': '#eee8d5',
  'solarized-light.brightCyan': '#93a1a1',
  'solarized-light.brightWhite': '#fdf6e3',
  'one-dark.black': '#282c34',
  'one-dark.brightBlack': '#5c6370',
  'github-dark.black': '#484f58',
  'dracula.black': '#21222c',
  'nord.black': '#3b4252',
  'nord.brightBlack': '#4c566a',
  'catppuccin.black': '#45475a',
  'catppuccin.brightBlack': '#585b70',
  'github-light.brightWhite': '#ffffff',
  'gruvbox-dark.black': '#282828',
  'tokyo-night.black': '#15161e',
  'tokyo-night.brightBlack': '#414868',
  'night-owl.black': '#011627',
  'monokai-light.yellow': '#c2a100',
  'monokai-light.brightYellow': '#c2a100',
  'monokai-light.brightWhite': '#f9f9f5',
  'one-light.brightBlack': '#9da5b4',
  'one-light.brightWhite': '#fafafa',
  'dracula-pro-light.brightWhite': '#faf9f7',
  'papercolor-light.brightWhite': '#eeeeee',
  'custom.black': '#000000',
}

// Released palette whose shipped value is an 8-digit (alpha) hex, frozen for the
// same reason as the contrast pins above.
const FROZEN_COLOR_FORMAT: Record<string, string> = {
  'github-dark.selectionBackground': '#388bfd26',
}

const FOREGROUND_FLOOR = 4.5
const ANSI_FLOOR = 2.5

function channelLuminance(channel: number): number {
  return channel <= 0.03928
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4)
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map(position =>
    channelLuminance(parseInt(hex.slice(position, position + 2), 16) / 255),
  )
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(a: string, b: string): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (left, right) => right - left,
  )
  return (high + 0.05) / (low + 0.05)
}

function frozen(
  key: ColorKey,
  preset: TerminalThemePreset,
): string | undefined {
  return FROZEN_BELOW_FLOOR[`${preset}.${key}`]
}

describe('terminal theme palettes', () => {
  it('defines every color key for every preset', () => {
    for (const preset of presetIds) {
      const colors: TerminalThemeColors = terminalThemes[preset]
      expect(Object.keys(colors).sort()).toEqual([...COLOR_KEYS].sort())
      for (const key of COLOR_KEYS) {
        expect(typeof colors[key], `${preset}.${key}`).toBe('string')
        expect(colors[key].length, `${preset}.${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('uses only 6-digit hex colors', () => {
    for (const preset of presetIds) {
      const colors: TerminalThemeColors = terminalThemes[preset]
      for (const key of COLOR_KEYS) {
        const pinned = FROZEN_COLOR_FORMAT[`${preset}.${key}`]
        if (pinned) {
          expect(colors[key], `${preset}.${key}`).toBe(pinned)
          continue
        }
        expect(colors[key], `${preset}.${key}`).toMatch(HEX_COLOR)
      }
    }
  })

  it('keeps every foreground readable on its own background', () => {
    for (const preset of presetIds) {
      const colors = terminalThemes[preset]
      const pinned = frozen('foreground', preset)
      const ratio = contrastRatio(colors.foreground, colors.background)
      if (pinned) {
        expect(colors.foreground, `${preset}.foreground`).toBe(pinned)
        expect(ratio).toBeLessThan(FOREGROUND_FLOOR)
        continue
      }
      expect(
        ratio,
        `${preset} foreground on background`,
      ).toBeGreaterThanOrEqual(FOREGROUND_FLOOR)
    }
  })

  it('keeps every ANSI color distinguishable from its background', () => {
    for (const preset of presetIds) {
      const colors = terminalThemes[preset]
      for (const key of ANSI_KEYS) {
        const pinned = frozen(key, preset)
        const ratio = contrastRatio(colors[key], colors.background)
        if (pinned) {
          expect(colors[key], `${preset}.${key}`).toBe(pinned)
          expect(ratio, `${preset}.${key}`).toBeLessThan(ANSI_FLOOR)
          continue
        }
        expect(ratio, `${preset}.${key}`).toBeGreaterThanOrEqual(ANSI_FLOOR)
      }
    }
  })

  it('gives every preset its own background', () => {
    const backgrounds = presetIds.map(
      preset => terminalThemes[preset].background,
    )
    expect(new Set(backgrounds).size).toBe(presetIds.length)
  })

  it('registers every preset in the palette, the names and one panel group', () => {
    const grouped = [...darkThemes, ...lightThemes]
    for (const preset of presetIds) {
      expect(terminalThemes[preset], `${preset} palette`).toBeDefined()
      expect(themeDisplayNames[preset], `${preset} display name`).toBeTruthy()
      if (UNGROUPED_PRESETS.includes(preset)) {
        expect(grouped).not.toContain(preset)
        continue
      }
      expect(grouped.filter(id => id === preset)).toHaveLength(1)
    }
    expect(new Set(grouped).size).toBe(grouped.length)
  })

  it('files the new dark presets under dark and the new light presets under light', () => {
    for (const preset of NEW_DARK_PRESETS) {
      expect(darkThemes).toContain(preset)
      expect(lightThemes).not.toContain(preset)
    }
    for (const preset of NEW_LIGHT_PRESETS) {
      expect(lightThemes).toContain(preset)
      expect(darkThemes).not.toContain(preset)
    }
    for (const preset of [...NEW_DARK_PRESETS, ...NEW_LIGHT_PRESETS]) {
      expect(presetIds).toContain(preset)
      expect(themeDisplayNames[preset]).toBeTruthy()
    }
  })

  it('falls back to one-dark for an unknown preset', () => {
    const unknown = 'no-such-theme' as TerminalThemePreset
    expect(getThemeColors(unknown)).toBe(terminalThemes['one-dark'])
  })
})
