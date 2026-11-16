// The selection a capability-gated extension can read.
//
// Two independent sources must agree: what the active terminal published, and which
// tab the user is looking at. Either alone is wrong — the published value is from some
// moment, and the active tab may have changed since.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetTerminalSelectionForTests,
  publishTerminalSelection,
} from '@/features/terminal/services/terminal-selection'

const mocks = vi.hoisted(() => ({ activeTabId: null as string | null }))

vi.mock('@/store/app', () => ({
  useAppStore: { getState: () => ({ activeTabId: mocks.activeTabId }) },
}))

// The DB read the snippet dock performs on activation, stubbed so this test is about
// the gateway rather than about SQLite.
vi.mock('@/service/database/snippets', () => ({
  getSnippets: vi.fn(async () => []),
}))

const { getExtensionRegistry, __resetExtensionRegistryForTests } = await import(
  './use-extension-runtime'
)

/** Reach the gateway the runtime attached — the same object extensions receive. */
function attachedGateway() {
  return (
    getExtensionRegistry() as unknown as {
      gateway: {
        readSelectedText(id: string, generation: number): Promise<unknown>
      }
    }
  ).gateway
}

beforeEach(() => {
  __resetExtensionRegistryForTests()
  __resetTerminalSelectionForTests()
  mocks.activeTabId = null
})

describe('the gateway sees a selection only when two sources agree', () => {
  it('reads the published text when the active tab published it', async () => {
    const registry = getExtensionRegistry()
    await registry.enable('snippet-dock')
    const generation = registry.get('snippet-dock')!.generation

    mocks.activeTabId = 'tab-1'
    publishTerminalSelection('tab-1', 'kubectl get pods')

    await expect(
      attachedGateway().readSelectedText('snippet-dock', generation),
    ).resolves.toMatchObject({ text: 'kubectl get pods', sessionId: 'tab-1' })
  })

  it('reads nothing when the selection belongs to another tab', async () => {
    // The user selected something on tab-2 and switched to tab-1. Handing that to an
    // extension would be text they did not choose in the session they can see.
    const registry = getExtensionRegistry()
    await registry.enable('snippet-dock')
    const generation = registry.get('snippet-dock')!.generation

    mocks.activeTabId = 'tab-1'
    publishTerminalSelection('tab-2', 'secret from the other host')

    await expect(
      attachedGateway().readSelectedText('snippet-dock', generation),
    ).resolves.toBeNull()
  })

  it('reads nothing when no tab is active', async () => {
    const registry = getExtensionRegistry()
    await registry.enable('snippet-dock')
    const generation = registry.get('snippet-dock')!.generation

    mocks.activeTabId = null
    publishTerminalSelection('tab-1', 'ls')

    await expect(
      attachedGateway().readSelectedText('snippet-dock', generation),
    ).resolves.toBeNull()
  })

  it('reads nothing when the user has selected nothing', async () => {
    const registry = getExtensionRegistry()
    await registry.enable('snippet-dock')
    const generation = registry.get('snippet-dock')!.generation

    mocks.activeTabId = 'tab-1'
    await expect(
      attachedGateway().readSelectedText('snippet-dock', generation),
    ).resolves.toBeNull()
  })

  it('refuses a disabled extension even with a valid selection', async () => {
    const registry = getExtensionRegistry()
    await registry.enable('snippet-dock')
    mocks.activeTabId = 'tab-1'
    publishTerminalSelection('tab-1', 'ls')
    const generation = registry.get('snippet-dock')!.generation
    await registry.deactivate('snippet-dock')

    await expect(
      attachedGateway().readSelectedText('snippet-dock', generation),
    ).rejects.toMatchObject({ denial: 'stale-generation' })
  })
})
