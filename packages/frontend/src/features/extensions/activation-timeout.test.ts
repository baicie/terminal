// A factory that finishes after its activation budget expired must not register.
//
// ## The gap
//
// `withBudget` rejects on timeout, but the factory promise keeps running —
// `Promise.race` semantics cannot cancel anything. When that late factory reaches
// `context.commands.register(...)`, the context still points at the failed
// activation's contribution ledger, and the rollback meant to settle it has already
// run. The command lands in a ledger nobody will clear.

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

describe('a factory that finishes after its budget', () => {
  it('cannot register once the activation was abandoned', async () => {
    vi.useFakeTimers()
    try {
      const registry = new ExtensionRegistry()
      let releaseFactory: () => void = () => undefined
      let lateRegistered = false

      registry.register(manifest('slow'), context => {
        // Registering after the budget expired is the thing under test. The factory
        // itself returns a pending promise, which `withBudget` will reject.
        return new Promise<void>(resolve => {
          releaseFactory = () => {
            context.commands.register({
              id: 'slow.late',
              titleKey: 'extensions.probe.name',
              run: async () => 1,
            })
            lateRegistered = true
            resolve()
          }
        }) as never
      })

      const internals = registry as unknown as {
        disposables: Map<string, unknown[]>
      }
      // Capture the bucket while it is still reachable, then observe it afterwards.
      let capturedBucket: unknown[] = []
      const originalSet = internals.disposables.set.bind(internals.disposables)
      internals.disposables.set = (key: string, value: unknown[]) => {
        capturedBucket = value
        return originalSet(key, value as never)
      }

      const enabling = registry.enable('slow')
      await vi.advanceTimersByTimeAsync(6_000)
      const enabled = await enabling
      expect(enabled).toBe(false)
      expect(registry.get('slow')?.status).toBe('failed')
      const bucketAtSettlement = capturedBucket.length

      // The factory finishes now — after its activation was abandoned.
      releaseFactory()
      await vi.advanceTimersByTimeAsync(10)
      const bucketAfterLateRegistration = capturedBucket.length

      // The call happens either way; what matters is that it registers nothing and
      // that the disposable it would have produced never enters a live bucket.
      expect(lateRegistered).toBe(true)
      expect(
        registry.commands().map(command => command.id),
        'a timed-out activation must not be able to register after the fact',
      ).toEqual([])
      expect(
        bucketAfterLateRegistration,
        'the retired activation\'s bucket must not gain an entry after it was settled',
      ).toEqual(bucketAtSettlement)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('recovery after a timeout', () => {
  it('lets a retry activate fully once the slow factory is out of the way', async () => {
    vi.useFakeTimers()
    try {
      const registry = new ExtensionRegistry()
      let attempt = 0
      registry.register(manifest('slow'), context => {
        attempt += 1
        if (attempt === 1) {
          return new Promise<void>(() => undefined) as never
        }
        context.commands.register({
          id: 'slow.run',
          titleKey: 'extensions.probe.name',
          run: async () => 1,
        })
        return undefined
      })

      const first = registry.enable('slow')
      await vi.advanceTimersByTimeAsync(6_000)
      expect(await first).toBe(false)

      // The retry must be allowed, and must end with a working registration.
      const second = registry.enable('slow')
      await vi.advanceTimersByTimeAsync(10)
      expect(await second).toBe(true)
      expect(registry.commands().map(c => c.id)).toEqual(['slow.run'])
      expect(registry.get('slow')?.status).toBe('active')
    } finally {
      vi.useRealTimers()
    }
  })

  it('survives repeated timeouts without accumulating registrations', async () => {
    vi.useFakeTimers()
    try {
      const registry = new ExtensionRegistry()
      // A holder object: TypeScript narrows a bare `let` to `never` when a closure
      // assigns it, because the assignment is not visible at the call site.
      const captured: { late?: () => void } = {}
      registry.register(manifest('slow'), context => {
        captured.late ??= () => {
          context.commands.register({
            id: 'slow.late',
            titleKey: 'extensions.probe.name',
            run: async () => 1,
          })
        }
        return new Promise<void>(() => undefined) as never
      })

      for (let round = 0; round < 3; round += 1) {
        const enabling = registry.enable('slow')
        await vi.advanceTimersByTimeAsync(6_000)
        expect(await enabling).toBe(false)
      }

      // Every timed-out activation that finishes late must register nothing.
      captured.late?.()
      await vi.advanceTimersByTimeAsync(10)
      expect(registry.commands()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
