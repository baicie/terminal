// The banner existing is not the fix — the panel has to mount it. Without this
// test, deleting the `<ShortcutPersistBanner />` line keeps every other test green
// while the user goes back to being told nothing.

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let persistState: { status: string; error: string | null } = {
  status: 'idle',
  error: null,
}

vi.mock('@/service/shortcuts', () => ({
  shortcutsService: {
    getShortcuts: () => [
      {
        id: 'open-palette',
        name: 'Open palette',
        description: '',
        keys: ['Meta', 'K'],
        enabled: true,
      },
    ],
    getPersistState: () => persistState,
    onPersistStateChange: () => () => undefined,
    retryPersist: () => Promise.resolve(true),
    parseKeyboardEvent: () => [],
    updateShortcut: () => true,
    resetToDefault: () => undefined,
  },
  defaultShortcuts: [],
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

describe('settings panel wiring', () => {
  beforeEach(() => {
    persistState = { status: 'idle', error: null }
  })

  it('shows the failure banner a failed save produces', async () => {
    persistState = { status: 'failed', error: 'sqlite is read-only' }
    const { ShortcutsSettings } = await import('./shortcuts-settings')
    render(<ShortcutsSettings />)

    const alert = await screen.findByRole('alert')
    expect(alert).toBeTruthy()
    expect(alert.textContent).toContain('sqlite is read-only')
  })

  it('still renders the shortcut list beside it', async () => {
    persistState = { status: 'failed', error: 'x' }
    const { ShortcutsSettings } = await import('./shortcuts-settings')
    render(<ShortcutsSettings />)
    expect(screen.getByText('Open palette')).toBeTruthy()
  })
})
