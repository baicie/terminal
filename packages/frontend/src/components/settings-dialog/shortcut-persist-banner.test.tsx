// A save the user cannot see failing is a save they will believe happened. The
// service records the failure; this test proves the settings panel shows it and
// offers the retry that clears it.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShortcutPersistBanner } from './shortcut-persist-banner'

const listeners = new Set<
  (state: { status: string; error: string | null }) => void
>()
let state: { status: string; error: string | null } = {
  status: 'idle',
  error: null,
}

vi.mock('@/service/shortcuts', () => ({
  shortcutsService: {
    getPersistState: () => state,
    onPersistStateChange: (
      listener: (next: { status: string; error: string | null }) => void,
    ) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    retryPersist: () => Promise.resolve(true),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

function emit(next: { status: string; error: string | null }): void {
  state = next
  listeners.forEach(listener => listener(next))
}

beforeEach(() => {
  listeners.clear()
  state = { status: 'idle', error: null }
})

describe('no banner without a failure', () => {
  it('renders nothing while idle', () => {
    const { container } = render(<ShortcutPersistBanner />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing after a successful save', () => {
    state = { status: 'saved', error: null }
    const { container } = render(<ShortcutPersistBanner />)
    expect(container.innerHTML).toBe('')
  })
})

describe('a failed save is visible', () => {
  it('shows the banner and the reason', async () => {
    state = { status: 'failed', error: 'sqlite is read-only' }
    render(<ShortcutPersistBanner />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('settings.shortcuts.saveFailed')
    expect(alert.textContent).toContain('sqlite is read-only')
  })

  it('appears when a later save fails, without a remount', async () => {
    const { container } = render(<ShortcutPersistBanner />)
    expect(container.innerHTML).toBe('')

    emit({ status: 'failed', error: 'disk full' })
    expect((await screen.findByRole('alert')).textContent).toContain(
      'disk full',
    )
  })

  it('offers a retry that asks the service to save again', async () => {
    const retry = vi.fn(() => Promise.resolve(true))
    const { shortcutsService } = await import('@/service/shortcuts')
    vi.spyOn(shortcutsService, 'retryPersist').mockImplementation(retry)

    state = { status: 'failed', error: 'nope' }
    render(<ShortcutPersistBanner />)

    fireEvent.click(
      screen.getByRole('button', { name: /settings.shortcuts.retrySave/ }),
    )
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('disappears once a retry succeeds', async () => {
    const { shortcutsService } = await import('@/service/shortcuts')
    vi.spyOn(shortcutsService, 'retryPersist').mockImplementation(() => {
      emit({ status: 'saved', error: null })
      return Promise.resolve(true)
    })

    state = { status: 'failed', error: 'nope' }
    const { container } = render(<ShortcutPersistBanner />)
    await screen.findByRole('alert')

    fireEvent.click(
      screen.getByRole('button', { name: /settings.shortcuts.retrySave/ }),
    )
    await waitFor(() => expect(container.innerHTML).toBe(''))
  })

  it('stops listening after unmount', () => {
    state = { status: 'failed', error: 'x' }
    const { unmount } = render(<ShortcutPersistBanner />)
    unmount()
    expect(listeners.size).toBe(0)
  })
})
