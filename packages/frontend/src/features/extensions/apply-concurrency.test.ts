// The final registry state must match the newest *persisted* choice.
//
// ## The ordering the task names
//
//     startup enable begins  →  user turns the switch off  →  old enable finishes
//     →  the saved list says off  →  registry ends up active
//
// `applyEnabledExtensions` is the only place that reconciles the registry with a list,
// and two callers reach it concurrently: `App` at boot (which reads `app_settings`,
// awaits several other preferences, then applies) and the Settings toggle.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/service/database/snippets', () => ({ getSnippets: vi.fn(async () => []) }))
vi.mock('@/store/app', () => ({ useAppStore: { getState: () => ({ activeTabId: null }) } }))

const {
  getExtensionRegistry,
  __resetExtensionRegistryForTests,
} = await import('@/features/extensions/use-extension-runtime')
const {
  applyEnabledExtensions,
  nextExtensionListSequence,
  __resetExtensionApplyQueueForTests,
} = await import('@/features/extensions/apply-enabled-extensions')

beforeEach(() => {
  __resetExtensionRegistryForTests()
  __resetExtensionApplyQueueForTests()
})

function activeIds() {
  return getExtensionRegistry()
    .list()
    .filter(record => record.status === 'active')
    .map(record => record.manifest.id)
}

describe('a startup snapshot racing a user toggle', () => {
  it('the newer choice wins even when the older apply runs last', async () => {
    // Startup claims its sequence *before* reading storage — that is what makes its
    // list a snapshot rather than the current truth.
    const startupSequence = nextExtensionListSequence()

    // The user turns the extension on; that apply carries a newer sequence.
    await applyEnabledExtensions(['snippet-dock'])
    expect(activeIds()).toEqual(['snippet-dock'])

    // Startup's stale list (empty, read before the toggle) arrives now.
    await applyEnabledExtensions({ ids: [], sequence: startupSequence })

    expect(
      activeIds(),
      'the startup snapshot describes a past the user has left',
    ).toEqual(['snippet-dock'])
  })

  it('a toggle-off landing after a startup enable still ends off', async () => {
    const startupSequence = nextExtensionListSequence()
    // Startup read "on" before the user's click.
    const startupApply = applyEnabledExtensions({
      ids: ['snippet-dock'],
      sequence: startupSequence,
    })
    // The user turns it off while that is in flight; this apply is newer.
    const userApply = applyEnabledExtensions([])
    await Promise.all([startupApply, userApply])

    expect(
      activeIds(),
      'the newest persisted choice is off, so the registry must be off',
    ).toEqual([])
  })
})

describe('two rapid toggles', () => {
  it('ends on the last one regardless of which apply finishes first', async () => {
    const a = applyEnabledExtensions(['snippet-dock'])
    const b = applyEnabledExtensions([])
    await Promise.all([a, b])
    expect(activeIds()).toEqual([])
  })

  it('ends on when the last one is on', async () => {
    await applyEnabledExtensions([])
    await applyEnabledExtensions(['snippet-dock'])
    expect(activeIds()).toEqual(['snippet-dock'])
  })
})
