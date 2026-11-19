// Flipping the switch must store the choice, not only apply it.
//
// ## The defect this pins
//
// The toggle called `applyEnabledExtensions` and never wrote `app_settings`. So the
// database kept the old list while the registry ran the new one, and the switch
// rendered "on" over a setting that still said off.
//
// Two consequences, both measured: the choice was lost on relaunch (which is the very
// failure `apply-enabled-extensions.ts` exists to prevent), and anything that
// re-applied the *stored* list — a save from this page, or the startup apply — put the
// registry back to the stale value while the switch stayed "on".
//
// ## Why this drives the real page, not the panel
//
// `ExtensionSettings` only calls `onChange`. The persistence decision lives in
// `SettingsView`, so a test of the panel cannot see this bug at all — it was green
// throughout. This renders the page and asserts the settings row was written.

import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/locales'
import SettingsView from './index'

const mocks = vi.hoisted(() => ({
  getAppSettings: vi.fn(),
  saveAppSettings: vi.fn(async () => undefined),
  applyEnabledExtensions: vi.fn(async () => undefined),
  list: vi.fn(),
}))

vi.mock('@/service/database', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    getAppSettings: mocks.getAppSettings,
    saveAppSettings: mocks.saveAppSettings,
  }
})

vi.mock('@/store/app', () => ({
  useAppStore: () => ({ setTheme: vi.fn(), setLanguage: vi.fn() }),
}))

vi.mock('@/features/extensions/apply-enabled-extensions', () => ({
  applyEnabledExtensions: mocks.applyEnabledExtensions,
  nextExtensionListSequence: () => 1,
}))

vi.mock('@/features/extensions/use-extension-runtime', () => ({
  getExtensionRegistry: () => ({
    list: mocks.list,
    cleanupProblemsFor: () => [],
  }),
  useExtensionRuntime: () => ({ activeIds: () => [] }),
}))

vi.mock('@/features/ai/use-ai-runtime', () => ({
  useAiRuntime: () => ({ profiles: [], save: async () => undefined }),
}))

function record(id: string, nameKey: string) {
  return {
    manifest: {
      id,
      nameKey,
      version: '1.0.0',
      apiVersion: 1,
      entry: `built-in:${id}`,
      capabilities: ['commands.register'],
      platforms: ['macos'],
      defaultEnabled: false,
    },
    status: 'registered',
    generation: 0,
  }
}

const SETTINGS = {
  theme: 'light',
  language: 'en',
  fontSize: 14,
  fontFamily: 'Menlo',
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
  enabledExtensions: [],
} as never

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  mocks.getAppSettings.mockResolvedValue(SETTINGS)
  mocks.list.mockReturnValue([record('snippet-dock', 'extensions.snippetDock.name')])
})

describe('toggling an extension writes it to the settings row', () => {
  it('persists the id when the switch goes on, in the same action that applies it', async () => {
    render(<SettingsView />)

    // Radix tabs switch on keyboard activation, not on a bare `click` from
    // `fireEvent`; the GUI spec uses WebDriver's real pointer for the same reason.
    const tab = await screen.findByRole('tab', { name: /extension/i })
    await act(async () => {
      fireEvent.keyDown(tab, { key: 'Enter' })
      await Promise.resolve()
    })
    const toggle = await screen.findByRole('switch', {}, { timeout: 3000 })
    await act(async () => {
      fireEvent.click(toggle)
      await Promise.resolve()
    })

    expect(
      mocks.saveAppSettings,
      'a switch that applies without persisting loses the choice on relaunch',
    ).toHaveBeenCalledWith(expect.objectContaining({ enabledExtensions: ['snippet-dock'] }))
    // The toggle's list comes straight from the click, so it is the newest thing the
    // process knows about and claims its sequence at apply time.
    expect(mocks.applyEnabledExtensions).toHaveBeenCalledWith(['snippet-dock'])
  })

  it('persists an empty list and applies it when the switch goes off', async () => {
    /*
     * The direction the first version of this test did not cover.
     *
     * Turning an extension *on* is the branch that builds `[...enabled, id]`. Turning
     * it *off* filters the id out, and a real WebView run showed the switch rendering
     * "unchecked" while the registry still reported the extension active — so the two
     * directions do not go through the same code, and only one of them was pinned.
     */
    mocks.getAppSettings.mockResolvedValue({
      ...(SETTINGS as Record<string, unknown>),
      enabledExtensions: ['snippet-dock'],
    })

    render(<SettingsView />)

    const tab = await screen.findByRole('tab', { name: /extension/i })
    await act(async () => {
      fireEvent.keyDown(tab, { key: 'Enter' })
      await Promise.resolve()
    })
    const toggle = await screen.findByRole('switch', {}, { timeout: 3000 })
    expect(toggle.getAttribute('data-state') ?? toggle.getAttribute('aria-checked')).toBe(
      'checked',
    )

    await act(async () => {
      fireEvent.click(toggle)
      await Promise.resolve()
    })

    expect(
      mocks.saveAppSettings,
      'turning it off must be written too, or the next re-apply turns it back on',
    ).toHaveBeenCalledWith(expect.objectContaining({ enabledExtensions: [] }))
    expect(mocks.applyEnabledExtensions).toHaveBeenCalledWith([])
  })
})
