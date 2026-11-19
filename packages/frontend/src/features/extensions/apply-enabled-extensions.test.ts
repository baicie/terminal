// The persisted enable list must be read, not just written.
//
// `enabledExtensions` was saved to `app_settings` and applied only while the Settings
// page was open. A user who enabled an extension, quit and relaunched found the switch
// still on and the extension still off — stored and never read. Task E's audit found
// it by asking what happens after a restart.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const registry = {
  list: vi.fn(),
  enable: vi.fn(),
  deactivate: vi.fn(),
}

vi.mock('./use-extension-runtime', () => ({
  getExtensionRegistry: () => registry,
}))

import {
  applyEnabledExtensions,
  nextExtensionListSequence,
} from './apply-enabled-extensions'

function record(id: string, status: 'active' | 'disabled' | 'failed') {
  return { manifest: { id }, status }
}

describe('applying the persisted extension list', () => {
  beforeEach(() => {
    registry.list.mockReset()
    registry.enable.mockReset().mockResolvedValue(true)
    registry.deactivate.mockReset().mockResolvedValue(undefined)
  })

  it('enables a listed extension that is not running', async () => {
    registry.list.mockReturnValue([record('snippet-dock', 'disabled')])
    await applyEnabledExtensions(['snippet-dock'])
    expect(registry.enable).toHaveBeenCalledWith('snippet-dock')
  })

  it('deactivates a running extension the list does not name', async () => {
    // `defaultEnabled: false` makes this the load-bearing half: an extension the user
    // turned off must not come back just because something enabled it in this session.
    registry.list.mockReturnValue([record('snippet-dock', 'active')])
    await applyEnabledExtensions([])
    expect(registry.deactivate).toHaveBeenCalledWith('snippet-dock')
    expect(registry.enable).not.toHaveBeenCalled()
  })

  it('leaves an already-correct extension alone', async () => {
    // Calling enable on an active extension is not harmless: the registry allocates a
    // new generation, and every subscription made in the old one is stale afterwards.
    registry.list.mockReturnValue([
      record('snippet-dock', 'active'),
      record('other', 'disabled'),
    ])
    await applyEnabledExtensions(['snippet-dock'])
    expect(registry.enable).not.toHaveBeenCalled()
    expect(registry.deactivate).not.toHaveBeenCalled()
  })

  it('re-enables an extension that previously failed', async () => {
    // `failed` is not `active`, so the list names it and the app should try again —
    // a transient failure must not be permanent until the user notices.
    registry.list.mockReturnValue([record('snippet-dock', 'failed')])
    await applyEnabledExtensions(['snippet-dock'])
    expect(registry.enable).toHaveBeenCalledWith('snippet-dock')
  })

  it('enables nothing when the saved list is empty', async () => {
    registry.list.mockReturnValue([record('snippet-dock', 'disabled')])
    await applyEnabledExtensions([])
    expect(registry.enable).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// A list read earlier must not undo a choice made later.
//
// Startup reads `app_settings`, then awaits several other preferences, then applies.
// Its list describes the moment it was read. Measured in a real WebView: the Settings
// switch flipped, the extension was active, and a few seconds later the registry was
// empty again with the switch still rendering "on" — a stale list arriving late is the
// only caller that deactivates without anyone clicking anything.
// ---------------------------------------------------------------------------

describe('a stale list does not undo a newer choice', () => {
  it('refuses a list whose sequence was taken before a newer one', async () => {
    registry.list.mockReturnValue([record('snippet-dock', 'active')])

    // Startup takes its sequence, then the user toggles the extension on, writing a
    // newer list. Startup's apply finally runs with the old (empty) list.
    const startupSequence = nextExtensionListSequence()
    await applyEnabledExtensions(['snippet-dock'])
    registry.list.mockReturnValue([record('snippet-dock', 'active')])

    registry.deactivate.mockClear()
    await applyEnabledExtensions({ ids: [], sequence: startupSequence })

    expect(
      registry.deactivate,
      'a list read before the user changed the switches must not deactivate what they enabled',
    ).not.toHaveBeenCalled()
  })

  it('still applies a list that is current or newer', async () => {
    registry.list.mockReturnValue([record('snippet-dock', 'active')])
    const sequence = nextExtensionListSequence()
    registry.deactivate.mockClear()
    await applyEnabledExtensions({ ids: [], sequence })
    expect(registry.deactivate).toHaveBeenCalledWith('snippet-dock')
  })
})
