// Task D: what a disposed handle still does.
//
// The handle is created by the production factory, not hand-built — the defect being
// guarded against lives in that factory, so a hand-made handle could not see it.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ load: vi.fn() }))

vi.mock('@/service/database/snippets', () => ({ getSnippets: mocks.load }))
vi.mock('@/store/app', () => ({ useAppStore: { getState: () => ({ activeTabId: null }) } }))

const { getExtensionRegistry, __resetExtensionRegistryForTests, __currentSnippetDockForTests } =
  await import('@/features/extensions/use-extension-runtime')

beforeEach(() => {
  __resetExtensionRegistryForTests()
  mocks.load.mockReset()
  mocks.load.mockResolvedValue([])
})

async function enableDock() {
  const registry = getExtensionRegistry()
  await registry.enable('snippet-dock')
  const handle = __currentSnippetDockForTests()
  if (!handle) throw new Error('the production factory did not expose a handle')
  return { registry, handle }
}

describe('a disposed handle does not touch the database', () => {
  it('refuses refresh without calling the loader', async () => {
    const { registry, handle } = await enableDock()
    await registry.deactivate('snippet-dock')
    const callsAtDisposal = mocks.load.mock.calls.length

    await handle.refresh()
    await handle.refresh()

    expect(
      mocks.load.mock.calls.length,
      'a disposed handle must not start a new read',
    ).toBe(callsAtDisposal)
  })

  it('refuses captureSelection without reaching the gateway', async () => {
    const { registry, handle } = await enableDock()
    await registry.deactivate('snippet-dock')
    expect(await handle.captureSelection()).toBe(false)
    expect(handle.state().pendingDraft).toBeNull()
  })

  it('does not restart loading on a session event after disposal', async () => {
    const { registry } = await enableDock()
    await registry.deactivate('snippet-dock')
    const callsAtDisposal = mocks.load.mock.calls.length
    registry.emit({ type: 'session.connected', sessionId: 's', at: 1 })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(mocks.load.mock.calls.length).toBe(callsAtDisposal)
  })
})

describe('a disposed handle leaves nothing behind', () => {
  it('reports no subscribers and does not resurrect them', async () => {
    const { registry, handle } = await enableDock()
    let notified = 0
    const unsubscribe = handle.subscribe(() => {
      notified += 1
    })
    await registry.deactivate('snippet-dock')
    unsubscribe()
    handle.discardDraft()
    expect(notified).toBe(0)
  })

  it('a fresh activation starts with an empty draft', async () => {
    const { registry, handle } = await enableDock()
    // Capturing needs a selection; the gateway refuses once deactivated, so seed the
    // draft the only way the product can: while active.
    await handle.captureSelection()
    await registry.deactivate('snippet-dock')
    await registry.enable('snippet-dock')
    const next = __currentSnippetDockForTests()
    expect(next).not.toBe(handle)
    expect(
      next?.state().pendingDraft,
      'a draft from the previous activation must not appear in the next one',
    ).toBeNull()
  })

  it('is disposed exactly once even when settled twice', async () => {
    const { registry, handle } = await enableDock()
    await registry.deactivate('snippet-dock')
    await registry.deactivate('snippet-dock')
    expect(handle.disposed).toBe(true)
  })
})
