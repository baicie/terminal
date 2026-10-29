import { beforeEach, describe, expect, it, vi } from 'vitest'

const listeners = new Map<string, (event: { payload: unknown }) => void>()
const unlisten = vi.fn()

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(
    async (name: string, handler: (event: { payload: unknown }) => void) => {
      if (name === 'terminal-error' && shouldFailErrorListener) {
        throw new Error('terminal-error listener registration failed')
      }
      listeners.set(name, handler)
      return () => {
        listeners.delete(name)
        unlisten()
      }
    },
  ),
}))

import { listen } from '@tauri-apps/api/event'
import { TerminalSessionEvents } from './terminal-session-events'

let shouldFailErrorListener = false

function createEvents() {
  return new TerminalSessionEvents({
    onOutput: vi.fn(),
    onClose: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
  })
}

describe('TerminalSessionEvents', () => {
  beforeEach(() => {
    listeners.clear()
    unlisten.mockClear()
    shouldFailErrorListener = false
    vi.mocked(listen).mockClear()
  })

  it('registers each channel listener exactly once across repeated ensure calls', async () => {
    const events = createEvents()
    await events.ensure('remote')
    await events.ensure('remote')
    await events.ensure('remote')

    const channelRegistrations = vi
      .mocked(listen)
      .mock.calls.filter(call => call[0] !== 'terminal-error')
    expect(channelRegistrations.map(call => call[0])).toEqual([
      'ssh-data',
      'ssh-close',
      'ssh-exit',
    ])
  })

  it('does not leak channel listeners when the error listener fails to register', async () => {
    // The channel listeners are created before the error listener settles, and
    // a rejection from Promise.all drops the cached entry. If the successful
    // channel registrations were not undone, the retry below would register a
    // second set of them and every output event would be delivered twice -- to
    // a terminal that would then render each chunk duplicated.
    shouldFailErrorListener = true
    const events = createEvents()

    await expect(events.ensure('remote')).rejects.toThrow(
      'terminal-error listener registration failed',
    )
    expect(listeners.size).toBe(0)

    shouldFailErrorListener = false
    await events.ensure('remote')

    expect([...listeners.keys()].sort()).toEqual([
      'ssh-close',
      'ssh-data',
      'ssh-exit',
      'terminal-error',
    ])
    // Exactly one live registration per channel. The first attempt's three
    // registrations were undone, so the retry must not have left them behind
    // alongside the new ones.
    const channelRegistrations = vi
      .mocked(listen)
      .mock.calls.filter(call => call[0] !== 'terminal-error')
    expect(channelRegistrations).toHaveLength(6)
    expect(unlisten).toHaveBeenCalledTimes(3)
  })

  it('keeps each tab type independent after a failed registration', async () => {
    // The cache is keyed by tab type, so a remote failure must not poison the
    // local or serial channels, and vice versa. A local terminal that silently
    // stopped receiving output because a remote one had a bad registration
    // would be a confusing, hard-to-report failure.
    shouldFailErrorListener = true
    const events = createEvents()
    await expect(events.ensure('remote')).rejects.toThrow()

    shouldFailErrorListener = false
    await events.ensure('local')
    await events.ensure('serial')

    expect([...listeners.keys()].sort()).toEqual([
      'local-close',
      'local-data',
      'serial-close',
      'serial-data',
      'terminal-error',
    ])
  })
})
