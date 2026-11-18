// A late callback from a dead activation must not blame the live one.
//
// ## The defect this pins
//
// `emit()` kept a handler and, when its promise rejected, called `this.fail(id, error)`
// — which marks whatever activation is *current*. If the extension is deactivated and
// re-enabled while a handler from the old activation is still running, its rejection
// lands on the new one:
//
//   activate (gen 1) → handler starts → deactivate → re-activate (gen 2)
//                                     ↘ throws here → gen 2 marked FAILED
//
// The user sees an extension that failed to start, for an error produced by a version
// of it that is no longer running. Worse, the gate then refuses the new activation's
// capabilities because the record says `failed`.
//
// The fix is generation-aware identity: a handler knows which activation created it, and
// a rejection only counts if that activation is still the current one.

import { describe, expect, it } from 'vitest'
import { ExtensionRegistry } from './extension-registry'
import type { BuiltInExtensionManifest } from './extension-manifest'
import type { ExtensionContext } from './extension-registry-types'

/**
 * A manifest shaped like a real one.
 *
 * The first version missing `nameKey`/`apiVersion`/`entry`/`platforms`: `register`
 * returns a `ManifestProblem` instead of throwing, and the test ignored the return
 * value — so it ran against an empty registry and reported the behaviour it was
 * supposed to be checking as "no handler ran". A registry that refused the manifest
 * looked exactly like a registry that dropped the event.
 */
function manifest(
  id = 'late-handler',
  capabilities: BuiltInExtensionManifest['capabilities'] = [
    'commands.register',
    'session.read-events',
  ],
): BuiltInExtensionManifest {
  return {
    id,
    nameKey: 'extensions.lateHandler.name',
    version: '1.0.0',
    apiVersion: 1,
    entry: 'built-in:late-handler',
    capabilities,
    platforms: ['macos', 'windows', 'linux'],
    defaultEnabled: false,
  }
}

/** Deterministic control over when a handler's promise settles. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('a handler from a retired activation cannot fail the current one', () => {
  it('does not mark the new activation failed when the old handler rejects', async () => {
    const registry = new ExtensionRegistry({ platform: 'macos' })
    const gate = deferred<void>()

    // The factory registers an event handler that settles when the test says so.
    const problem = registry.register(manifest(), (context: ExtensionContext) => {
      context.events.on('session.connected', async () => {
        await gate.promise
        throw new Error('the old activation threw')
      })
    })
    expect(problem, 'the fixture manifest must be accepted').toBeNull()
    await registry.enable('late-handler')

    // Start the handler under generation 1.
    registry.emit({ type: 'session.connected', at: 0 })

    // Retire generation 1 and start generation 2 while the handler is still pending.
    await registry.deactivate('late-handler')
    await registry.enable('late-handler')

    const enabledAfter = registry.get('late-handler')?.status === 'active'

    // Now let the *old* handler reject.
    gate.reject(new Error('ignored'))
    // Give the rejection a turn to land.
    await Promise.resolve()
    await Promise.resolve()

    expect(
      registry.get('late-handler')?.status,
      'a rejection from generation 1 must not mark generation 2 as failed',
    ).toBe('active')
    expect(enabledAfter).toBe(true)
  })

  it('does not deliver an event registered by a retired activation', async () => {
    // The other half: the handler map is rebuilt per activation, so a stale entry must
    // not even be invoked. This is what makes the generation check above a backstop
    // rather than the only defence.
    const registry = new ExtensionRegistry({ platform: 'macos' })
    const calls: number[] = []

    const problem = registry.register(manifest(), (context: ExtensionContext) => {
      context.events.on('session.connected', async () => {
        calls.push(1)
      })
    })
    expect(problem, 'the fixture manifest must be accepted').toBeNull()
    await registry.enable('late-handler')
    await registry.deactivate('late-handler')
    await registry.enable('late-handler')

    registry.emit({ type: 'session.connected', at: 0 })
    await Promise.resolve()

    // Only the live activation's handler ran. A retired handler running would be the
    // leak the design's "deactivate settles every registration" rule prevents.
    expect(calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// `menusFor`: the read side of `context.menus.register`.
//
// Nothing consumed these contributions before, so `terminal.context` registrations
// were dead and the snippet dock's capture step had no reachable entry in the app.
// The registry now exposes them; these pin the rules a host can rely on.
// ---------------------------------------------------------------------------

describe('menu contributions are readable by the host that renders them', () => {
  function registeringExtension(id: string) {
    return (context: ExtensionContext) => {
      context.commands.register({
        id: `${id}.capture`,
        titleKey: 'extensions.capture.title',
        run: async () => undefined,
      })
      context.menus.register({ location: 'terminal.context', commandId: `${id}.capture` })
      context.menus.register({ location: 'elsewhere', commandId: `${id}.capture` })
    }
  }

  it('returns only the entries for the requested location', async () => {
    const registry = new ExtensionRegistry({ platform: 'macos' })
    expect(registry.register(
      manifest('menu-ext', ['commands.register', 'menus.register']),
      registeringExtension('menu-ext'),
    )).toBeNull()
    await registry.enable('menu-ext')

    const items = registry.menusFor('terminal.context')
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual({
      extensionId: 'menu-ext',
      commandId: 'menu-ext.capture',
      // The title comes from the command, so a host renders one translation, not two.
      titleKey: 'extensions.capture.title',
    })
    expect(registry.menusFor('elsewhere')).toHaveLength(1)
    expect(registry.menusFor('nowhere')).toEqual([])
  })

  it('contributes nothing while the extension is disabled', async () => {
    // A disabled extension's menu entry would invoke a command that no longer exists.
    const registry = new ExtensionRegistry({ platform: 'macos' })
    registry.register(
      manifest('menu-ext', ['commands.register', 'menus.register']),
      registeringExtension('menu-ext'),
    )
    await registry.enable('menu-ext')
    expect(registry.menusFor('terminal.context')).toHaveLength(1)

    await registry.deactivate('menu-ext')
    expect(
      registry.menusFor('terminal.context'),
      'a retired activation must not leave a clickable entry behind',
    ).toEqual([])
  })

  it('does not offer a failed extension\'s menu entry', async () => {
    /*
     * A `failed` extension keeps its contributions — `fail()` only flips the status —
     * so the active check in `menusFor` is load-bearing, not redundant with
     * `deactivate` clearing them. Measured: removing that check left every other test
     * green, because the disabled case is handled by deactivation instead.
     *
     * A clickable entry for an extension that just crashed would invoke a command
     * whose handler already threw.
     */
    const registry = new ExtensionRegistry({ platform: 'macos' })
    const gate = deferred<void>()
    registry.register(
      manifest('menu-ext', ['commands.register', 'menus.register', 'session.read-events']),
      context => {
        context.commands.register({
          id: 'menu-ext.capture',
          titleKey: 'extensions.capture.title',
          run: async () => undefined,
        })
        context.menus.register({
          location: 'terminal.context',
          commandId: 'menu-ext.capture',
        })
        context.events.on('session.connected', async () => {
          await gate.promise
          throw new Error('the handler blew up')
        })
      },
    )
    await registry.enable('menu-ext')
    registry.emit({ type: 'session.connected', at: 0 })
    gate.reject(new Error('boom'))
    await Promise.resolve()
    await Promise.resolve()

    expect(registry.get('menu-ext')?.status).toBe('failed')
    expect(
      registry.menusFor('terminal.context'),
      'a failed extension must not keep a clickable menu entry',
    ).toEqual([])
  })

  it('is empty for an extension that never registered a menu', async () => {
    const registry = new ExtensionRegistry({ platform: 'macos' })
    registry.register(manifest('no-menu'), (context: ExtensionContext) => {
      context.commands.register({
        id: 'no-menu.run',
        titleKey: 't',
        run: async () => undefined,
      })
    })
    await registry.enable('no-menu')
    expect(registry.menusFor('terminal.context')).toEqual([])
  })
})
