// A retired activation's cleanup must not delete its replacement's registrations.
//
// ## The race
//
// `fail()` cannot await (its caller may be a synchronous emitter), so it starts a
// rollback and returns. Cleanup then clears the ledger by **extension id**, *after* an
// await:
//
//     const { problems } = await disposeAll(bucket)   // ← suspension point
//     this.contributions.delete(extensionId)
//     this.disposables.delete(extensionId)
//
// A second activation that lands during that suspension has its entries deleted by the
// first one's rollback. The extension then reports `active` with nothing registered —
// alive by status, unreachable in practice.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/service/database/snippets', () => ({ getSnippets: vi.fn(async () => []) }))
vi.mock('@/store/app', () => ({ useAppStore: { getState: () => ({ activeTabId: null }) } }))

const { ExtensionRegistry } = await import('@/features/extensions/extension-registry')
const { currentExtensionPlatform } = await import('@/features/extensions/extension-manifest')

const HOST = currentExtensionPlatform()

function manifest(id: string) {
  return {
    id,
    nameKey: 'extensions.probe.name',
    version: '1.0.0',
    apiVersion: 1,
    entry: `built-in:${id}`,
    capabilities: ['commands.register', 'menus.register', 'ui.right-dock', 'session.read-events'],
    platforms: [HOST],
    defaultEnabled: false,
  } as never
}

describe('a failed activation settling late', () => {
  it('does not delete the registrations of the activation that replaced it', async () => {
    const registry = new ExtensionRegistry()

    let releaseSlowDisposer: () => void = () => undefined
    const slowGate = new Promise<void>(resolve => {
      releaseSlowDisposer = resolve
    })
    let attempt = 0

    registry.register(manifest('racy'), context => {
      attempt += 1
      const mine = attempt
      context.commands.register({
        id: `racy.run.${mine}`,
        titleKey: 'extensions.probe.name',
        run: async () => mine,
      })
      if (mine === 1) {
        // Generation 1 registers an event handler that throws, plus a slow disposable.
        // The registry pushes the factory's return value last, so the command's own
        // disposers run first; the gate is what keeps the rollback suspended.
        context.events.on('session.connected', () => {
          throw new Error('handler exploded')
        })
        return { dispose: () => slowGate }
      }
      return undefined
    })

    await registry.enable('racy')
    // A generation-1 handler throws → fail() starts a rollback it cannot await.
    registry.emit({ type: 'session.connected', sessionId: 's', at: 1 })
    expect(registry.get('racy')?.status).toBe('failed')

    // The replacement starts while that rollback is suspended inside disposeAll.
    // `failed` is a state `enable` accepts directly — no deactivate needed, which is
    // exactly why this window is reachable in the product.
    await registry.enable('racy')
    const liveCommands = registry.commands().map(command => command.id)
    expect(registry.get('racy')?.status).toBe('active')

    // Let the retired activation finish settling.
    releaseSlowDisposer()
    await new Promise(resolve => setTimeout(resolve, 30))

    expect(
      registry.commands().map(command => command.id),
      'the live activation must keep its registrations',
    ).toEqual(liveCommands)
    expect(registry.get('racy')?.status).toBe('active')
  })
})

// ---------------------------------------------------------------------------
// The rest of the concurrency surface the task names.
// ---------------------------------------------------------------------------

/** A registry whose extension registers one command and an optional throwing handler. */
function makeRegistry(options: {
  handlerThrows?: boolean
  disposer?: () => void | Promise<void>
  factoryThrows?: () => boolean
} = {}) {
  const registry = new ExtensionRegistry()
  let attempt = 0
  registry.register(manifest('x'), context => {
    attempt += 1
    const mine = attempt
    context.commands.register({
      id: `x.run.${mine}`,
      titleKey: 'extensions.probe.name',
      run: async () => mine,
    })
    if (options.handlerThrows) {
      context.events.on('session.connected', () => {
        throw new Error('handler exploded')
      })
    }
    if (options.factoryThrows?.()) throw new Error('factory failed')
    return options.disposer ? { dispose: options.disposer } : undefined
  })
  return registry
}

describe('deactivate and enable racing', () => {
  it('a deactivate started before an enable does not leave the extension active', async () => {
    const registry = makeRegistry()
    await registry.enable('x')
    // Start both without awaiting the first: the second must not be able to claim the
    // activation while the first is still stopping.
    const stopping = registry.deactivate('x')
    const starting = registry.enable('x')
    await Promise.all([stopping, starting])

    const status = registry.get('x')?.status
    // Either the enable was refused (disabled) or it ran fully (active with a command).
    // What must never happen is `active` with nothing registered.
    if (status === 'active') {
      expect(registry.commands().map(c => c.id)).toHaveLength(1)
    } else {
      expect(status).toBe('disabled')
      expect(registry.commands()).toEqual([])
    }
  })

  it('two concurrent deactivates settle once and leave it disabled', async () => {
    const registry = makeRegistry()
    await registry.enable('x')
    await Promise.all([registry.deactivate('x'), registry.deactivate('x')])
    expect(registry.get('x')?.status).toBe('disabled')
    expect(registry.commands()).toEqual([])
  })

  it('a third enable during activation does not register twice', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const registry = new ExtensionRegistry()
    registry.register(manifest('slow'), context => {
      context.commands.register({
        id: 'slow.run',
        titleKey: 'extensions.probe.name',
        run: async () => 1,
      })
      // Sync factory that hands back a pending disposable, which is the shape a slow
      // activation takes from the registry's side.
      return { dispose: () => gate }
    })

    const first = registry.enable('slow')
    const second = registry.enable('slow')
    release()
    await Promise.all([first, second])

    expect(registry.commands().filter(c => c.id === 'slow.run')).toHaveLength(1)
  })
})

describe('a retired disposer that throws', () => {
  it('does not stop the new activation', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let attempt = 0
    const registry = new ExtensionRegistry()
    registry.register(manifest('x'), context => {
      attempt += 1
      const mine = attempt
      context.commands.register({
        id: `x.run.${mine}`,
        titleKey: 'extensions.probe.name',
        run: async () => mine,
      })
      if (mine === 1) {
        context.events.on('session.connected', () => {
          throw new Error('handler exploded')
        })
        return {
          dispose: async () => {
            await gate
            throw new Error('retired disposer threw')
          },
        }
      }
      return undefined
    })

    await registry.enable('x')
    registry.emit({ type: 'session.connected', sessionId: 's', at: 1 })
    await registry.enable('x')
    const live = registry.commands().map(c => c.id)
    release()
    await new Promise(resolve => setTimeout(resolve, 30))

    expect(registry.commands().map(c => c.id)).toEqual(live)
    expect(
      registry.cleanupProblemsFor('x'),
      'the retired disposer failure is recorded, not hidden',
    ).toEqual(['retired disposer threw'])
  })
})

describe('failing twice', () => {
  it('settles both attempts without leaving registrations behind', async () => {
    const registry = makeRegistry({ factoryThrows: () => true })
    expect(await registry.enable('x')).toBe(false)
    expect(await registry.enable('x')).toBe(false)
    expect(registry.get('x')?.status).toBe('failed')
    expect(registry.commands()).toEqual([])
  })
})
