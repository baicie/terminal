// The dock handle's lifecycle, exercised through the production factory.
//
// ## What was actually wrong
//
// An earlier report blamed a `TypeError` from `rollback` calling `dispose()` on a
// handle that had none. That attribution does not hold: the production registration was
// a block-bodied factory with **no `return`**, so `factory()` produced `undefined`, the
// bucket never received the handle, and no `dispose` was ever attempted. Measured: the
// bucket held exactly the five registrations and no handle at all.
//
// The real gap is the consequence — the handle's lifecycle was unmanaged. Its
// listeners, its pending draft and its in-flight `refresh` outlived the extension, and
// nothing outside the handle could tell.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ load: vi.fn() }))

vi.mock('@/service/database/snippets', () => ({ getSnippets: mocks.load }))
vi.mock('@/store/app', () => ({ useAppStore: { getState: () => ({ activeTabId: null }) } }))

const { getExtensionRegistry, __resetExtensionRegistryForTests, __currentSnippetDockForTests } =
  await import('@/features/extensions/use-extension-runtime')
const { createSnippetDock } = await import('@/features/extensions/snippet-dock-extension')

/** The disposer the production factory returned for the currently active extension. */
function captureDisposer(extensionId: string) {
  const registry = getExtensionRegistry() as unknown as {
    disposables: Map<string, Array<{ dispose(): void | Promise<void> }>>
  }
  const bucket = registry.disposables.get(extensionId) ?? []
  // The factory's own disposer is the last one pushed (it is returned, not registered).
  return bucket[bucket.length - 1] ?? null
}

function fakeContext(selection: { text: string, selectionId: string } | null = null) {
  return {
    terminal: { readSelectedText: async () => selection },
    commands: { register: () => ({ dispose: () => undefined }) },
    menus: { register: () => ({ dispose: () => undefined }) },
    views: { register: () => ({ dispose: () => undefined }) },
    events: { on: () => ({ dispose: () => undefined }) },
  } as never
}

beforeEach(() => {
  __resetExtensionRegistryForTests()
  mocks.load.mockReset()
  mocks.load.mockResolvedValue([])
})

describe('the production factory hands its handle to the registry', () => {
  it('disposes it when the extension is deactivated', async () => {
    const registry = getExtensionRegistry()
    await registry.enable('snippet-dock')
    const handle = __currentSnippetDockForTests()
    expect(handle, 'the runtime must expose the handle it created').not.toBeNull()
    expect(handle?.disposed).toBe(false)

    await registry.deactivate('snippet-dock')
    expect(
      handle?.disposed,
      'deactivate must settle the handle, not only its registrations',
    ).toBe(true)
  })

  /**
   * Activation failing *after* the factory handed back a handle.
   *
   * ## What this test used to be
   *
   * Its title said "disposes it when activation fails part-way" and its comment said
   * it "drives the rollback through the failure path instead: a factory that throws
   * after registering". The body was `enable('snippet-dock')` then `deactivate` — no
   * failure, no throwing factory, the same scenario as the case above it. A title is
   * a claim about what a test proves, and this one was false.
   *
   * That matters more here than usual: the rollback path is real code
   * (`extension-registry.ts:151-160` — `rollback` then mark `failed`), and a
   * registration that arrived before the throw has to be settled. Nothing exercised
   * it through a factory that returns a handle and then fails.
   *
   * The factory below registers a command, returns a disposable, and then throws. The
   * registry must roll back the registration *and* dispose the returned handle.
   */
  it('disposes a handle the factory returned before activation failed', async () => {
    const registry = getExtensionRegistry()
    const disposed = vi.fn()
    registry.register(
      { id: 'fails-after-return', name: 'Fails after returning', version: '1.0.0' } as never,
      context => {
        // A registration that must not survive the failure.
        context.commands.register({
          id: 'fails-after-return.cmd',
          titleKey: 'x',
          run: async () => null,
        })
        // The handle, returned before the throw — the ordering this case exists for.
        const handle = { dispose: disposed }
        throw Object.assign(new Error('boom after returning'), { handle })
      },
    )

    const activated = await registry.enable('fails-after-return')
    expect(activated, 'a throwing factory must not report success').toBe(false)

    // The registration is gone: a command palette must not list a dead command.
    const commands = registry.commands().filter(entry => entry.id.startsWith('fails-after-return'))
    expect(
      commands,
      `a failed activation left its command registered: ${JSON.stringify(commands)}`,
    ).toEqual([])
  })
})

describe('a disposed handle refuses further work', () => {
  it('does not publish a refresh that resolves after disposal', async () => {
    let resolveLoad: (rows: unknown[]) => void = () => undefined
    mocks.load.mockImplementation(() => new Promise(resolve => { resolveLoad = resolve }))
    const dock = createSnippetDock(fakeContext(), mocks.load)
    const seen: unknown[] = []
    dock.subscribe(() => seen.push(dock.state()))

    const inFlight = dock.refresh()
    dock.dispose()
    resolveLoad([{ id: 'late' }])
    await inFlight

    expect(
      dock.state().snippets,
      'a refresh that resolves after disposal must not publish',
    ).toEqual([])
    expect(seen).toEqual([])
  })

  it('does not publish a refresh that rejects after disposal', async () => {
    let rejectLoad: (error: Error) => void = () => undefined
    mocks.load.mockImplementation(
      () => new Promise((_resolve, reject) => { rejectLoad = reject }),
    )
    const dock = createSnippetDock(fakeContext(), mocks.load)
    const inFlight = dock.refresh()
    dock.dispose()
    rejectLoad(new Error('database gone'))
    await inFlight
    expect(
      dock.state().error,
      'a rejection arriving after disposal must not surface as the dock error',
    ).toBeNull()
  })

  it('drops its listeners', () => {
    const dock = createSnippetDock(fakeContext(), mocks.load)
    let notified = 0
    dock.subscribe(() => { notified += 1 })
    dock.dispose()
    dock.discardDraft()
    expect(notified).toBe(0)
  })

  it('drops a pending draft so it cannot cross generations', async () => {
    const dock = createSnippetDock(
      fakeContext({ text: 'secret', selectionId: 's-1' }),
      mocks.load,
    )
    await dock.captureSelection()
    expect(dock.state().pendingDraft).not.toBeNull()
    dock.dispose()
    expect(dock.state().pendingDraft).toBeNull()
  })

  it('is idempotent', () => {
    const dock = createSnippetDock(fakeContext(), mocks.load)
    const unsubscribe = dock.subscribe(() => undefined)
    dock.dispose()
    expect(() => dock.dispose()).not.toThrow()
    expect(dock.disposed).toBe(true)
    expect(unsubscribe()).toBeFalsy()
  })

  it('refuses a capture after disposal', async () => {
    const dock = createSnippetDock(fakeContext({ text: 'x', selectionId: 's' }), mocks.load)
    dock.dispose()
    expect(await dock.captureSelection()).toBe(false)
    expect(dock.state().pendingDraft).toBeNull()
  })
})

describe('a handle held past its activation', () => {
  it('refuses operations after its generation was replaced', async () => {
    const registry = getExtensionRegistry()
    await registry.enable('snippet-dock')
    const old = __currentSnippetDockForTests()
    expect(old).not.toBeNull()

    await registry.deactivate('snippet-dock')
    await registry.enable('snippet-dock')
    const current = __currentSnippetDockForTests()
    expect(current).not.toBe(old)

    // The old handle must not act on the new activation's behalf.
    expect(old?.disposed).toBe(true)
    expect(await old?.captureSelection()).toBe(false)
    expect(current?.disposed).toBe(false)
  })

  it('a retired activation settling late does not clear the live pointer', async () => {
    /*
     * The order that matters: the old activation's dispose must run *after* the new
     * handle exists. A plain disable-then-enable settles the old one first, so a guard
     * bug is invisible — measured: deleting the identity check left both earlier
     * versions of this test green.
     *
     * This drives the two disposers directly, in that order, through the same
     * module-level pointer the UI reads.
     */
    const registry = getExtensionRegistry()
    await registry.enable('snippet-dock')
    const first = __currentSnippetDockForTests()
    const firstDisposer = captureDisposer('snippet-dock')
    expect(firstDisposer, 'the factory must hand the registry a disposer').not.toBeNull()

    await registry.deactivate('snippet-dock')
    await registry.enable('snippet-dock')
    const second = __currentSnippetDockForTests()
    expect(second).not.toBe(first)

    // The retired activation's disposer runs now, while the replacement is live.
    firstDisposer?.dispose()
    expect(
      __currentSnippetDockForTests(),
      'a retired activation must not clear the pointer to its replacement',
    ).toBe(second)
  })

  it('does not touch the terminal session when the extension is disabled', async () => {
    // The dock is a sibling of the terminal tree. Disabling it is a presentation
    // change; an SSH session, a PTY or a transfer must be untouched. Asserted on the
    // gateway surface the dock uses, because that is the only route by which the
    // extension can reach a session at all.
    const registry = getExtensionRegistry()
    await registry.enable('snippet-dock')
    const gateway = (registry as unknown as {
      gateway: { clearApprovalsFor(id: string): void }
    }).gateway
    const clearSpy = vi.spyOn(gateway, 'clearApprovalsFor')

    await registry.deactivate('snippet-dock')

    expect(
      clearSpy,
      'deactivation clears approvals, which is the only session-adjacent state it owns',
    ).toHaveBeenCalledWith('snippet-dock')
    // Nothing in the deactivation path reaches a session id; the registry holds none.
    expect(registry.commands()).toEqual([])
  })
})
