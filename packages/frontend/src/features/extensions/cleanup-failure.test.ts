// What happens when a disposer throws.
//
// ## The property before this
//
// `rollback` caught every disposer error and said nothing. "Released everything", "one
// disposer threw and the rest were attempted" and "one threw and stopped the others"
// all produced a `disabled` record and no observable difference.
//
// ## What is asserted now
//
// Every disposer is still attempted (one failure does not strand the rest), and the
// failure is recorded where a caller can read it rather than dropped.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/service/database/snippets', () => ({ getSnippets: vi.fn(async () => []) }))
vi.mock('@/store/app', () => ({ useAppStore: { getState: () => ({ activeTabId: null }) } }))

const { ExtensionRegistry } = await import('@/features/extensions/extension-registry')
const { currentExtensionPlatform } = await import('@/features/extensions/extension-manifest')

/** Match the host running the suite, so platform support is not the thing under test. */
const HOST = currentExtensionPlatform()
const { disposeAll } = await import('@/features/extensions/dispose-all')

function manifest(id: string) {
  return {
    id,
    nameKey: 'extensions.probe.name',
    version: '1.0.0',
    apiVersion: 1,
    entry: `built-in:${id}`,
    capabilities: [
      'commands.register',
      'menus.register',
      'ui.right-dock',
      'session.read-events',
    ],
    platforms: [HOST],
    defaultEnabled: false,
  } as never
}

describe('disposeAll attempts every entry', () => {
  it('runs the rest after one throws, and reports which threw', async () => {
    const ran: string[] = []
    const outcome = await disposeAll([
      { dispose: () => { ran.push('first') } },
      { dispose: () => { ran.push('second'); throw new Error('boom') } },
      { dispose: () => { ran.push('third') } },
    ])
    // Reverse order: later registrations may depend on earlier ones.
    expect(ran).toEqual(['third', 'second', 'first'])
    expect(outcome.problems).toEqual(['boom'])
    expect(outcome.attempted).toBe(3)
  })

  it('reports nothing when every disposer succeeds', async () => {
    const outcome = await disposeAll([{ dispose: () => undefined }])
    expect(outcome.problems).toEqual([])
  })
})

describe('the registry records cleanup failures instead of swallowing them', () => {
  it('surfaces a throwing disposer after deactivate', async () => {
    const registry = new ExtensionRegistry()
    registry.register(manifest('bad'), context => {
      context.commands.register({ id: 'bad.run', titleKey: 'k', run: async () => 1 })
      return { dispose: () => { throw new Error('cleanup exploded') } }
    })
    await registry.enable('bad')
    await registry.deactivate('bad')

    expect(registry.get('bad')?.status).toBe('disabled')
    expect(
      registry.cleanupProblemsFor('bad'),
      'a disposer that threw must be reported, not read as a clean release',
    ).toEqual(['cleanup exploded'])
  })

  it('still removes the registrations when a disposer throws', async () => {
    const registry = new ExtensionRegistry()
    registry.register(manifest('halfbad'), context => {
      context.commands.register({ id: 'halfbad.run', titleKey: 'k', run: async () => 1 })
      return {
        dispose: () => {
          throw new Error('only this one fails')
        },
      }
    })
    await registry.enable('halfbad')
    await registry.deactivate('halfbad')
    expect(
      registry.commands(),
      'the registrations must still be released even when one disposer throws',
    ).toEqual([])
  })

  it('clears the record on a later clean settlement', async () => {
    const registry = new ExtensionRegistry()
    let trips = 0
    registry.register(manifest('flaky'), context => {
      context.commands.register({ id: 'flaky.run', titleKey: 'k', run: async () => 1 })
      return {
        dispose: () => {
          trips += 1
          if (trips === 1) throw new Error('first time')
        },
      }
    })
    await registry.enable('flaky')
    await registry.deactivate('flaky')
    expect(registry.cleanupProblemsFor('flaky')).toEqual(['first time'])

    await registry.enable('flaky')
    await registry.deactivate('flaky')
    expect(
      registry.cleanupProblemsFor('flaky'),
      'a later clean deactivation must not keep reporting an earlier failure',
    ).toEqual([])
  })
})

describe('a failed callback settles what the extension still holds', () => {
  it('releases the registrations when a handler throws', async () => {
    const registry = new ExtensionRegistry()
    registry.register(manifest('thrower'), context => {
      context.commands.register({ id: 'thrower.run', titleKey: 'k', run: async () => 1 })
      context.events.on('session.connected', () => {
        throw new Error('handler exploded')
      })
    })
    await registry.enable('thrower')
    expect(registry.commands()).toHaveLength(1)

    registry.emit({ type: 'session.connected', sessionId: 's', at: 1 })

    expect(registry.get('thrower')?.status).toBe('failed')
    // The rollback is started synchronously by `fail`; give it a turn to settle.
    await vi.waitFor(() =>
      expect(
        registry.commands(),
        'a failed extension must not keep its registrations live and callable',
      ).toEqual([]),
    )
  })

  it('does not let a retired activation\'s late failure tear down its replacement', async () => {
    const registry = new ExtensionRegistry()
    let releaseHandler: () => void = () => undefined
    registry.register(manifest('racy'), context => {
      context.events.on('session.connected', async () => {
        await new Promise<void>(resolve => { releaseHandler = resolve })
        throw new Error('late rejection from the old activation')
      })
      context.commands.register({ id: 'racy.run', titleKey: 'k', run: async () => 1 })
    })

    await registry.enable('racy')
    registry.emit({ type: 'session.connected', sessionId: 's', at: 1 })
    // Retire that activation, then start a new one.
    await registry.deactivate('racy')
    await registry.enable('racy')
    // The old handler now rejects, with the new activation live.
    releaseHandler()
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(
      registry.get('racy')?.status,
      'a rejection from a retired activation must not mark the new one failed',
    ).toBe('active')
    expect(registry.commands().map(c => c.id)).toContain('racy.run')
  })
})
