// The extension lifecycle, tested through the failures that matter.
//
// The design's Level 1/2 matrix (`06-ux3-extension-platform.md` §8) asks for
// exactly these: enable→disable→enable returning to baseline, partial activation
// rolling back, a deactivate with async work in flight, a throwing callback not
// touching the terminal, and manifest validation.

import { describe, expect, it, vi } from 'vitest'
import { CapabilityGateway } from './capability-gateway'
import { ExtensionRegistry } from './extension-registry'
import type { ExtensionContext } from './extension-registry-types'
import {
  currentExtensionPlatform,
  supportsPlatform,
  validateManifest,
  type BuiltInExtensionManifest,
} from './extension-manifest'

function manifest(overrides: Partial<BuiltInExtensionManifest> = {}): BuiltInExtensionManifest {
  return {
    id: 'snippet-dock',
    nameKey: 'extensions.snippetDock.name',
    version: '1.0.0',
    apiVersion: 1,
    entry: 'built-in:snippet-dock',
    capabilities: ['commands.register', 'menus.register', 'ui.right-dock'],
    platforms: ['macos', 'windows', 'linux'],
    defaultEnabled: false,
    ...overrides,
  }
}

describe('manifest validation', () => {
  it('accepts a well-formed manifest', () => {
    expect(validateManifest(manifest())).toBeNull()
  })

  it.each([
    ['invalid-id', manifest({ id: 'Snippet Dock' })],
    ['invalid-name-key', manifest({ nameKey: 'Snippet Dock' })],
    ['invalid-version', manifest({ version: 'v1' })],
    ['unsupported-api-version', manifest({ apiVersion: 2 })],
    ['invalid-entry', manifest({ entry: 'https://example.test/ext.js' as never })],
    ['empty-capabilities', manifest({ capabilities: [] })],
    ['unknown-capability', manifest({ capabilities: ['secret.read' as never] })],
    ['empty-platforms', manifest({ platforms: [] })],
    ['unknown-platform', manifest({ platforms: ['beos' as never] })],
  ])('rejects %s', (rejection, input) => {
    expect(validateManifest(input)?.rejection).toBe(rejection)
  })

  it('refuses an entry that could name dynamic code', () => {
    // The trust model in one assertion: `entry` is a compile-time key, never a
    // module specifier, URL or path. A field that could name code would invite
    // adding dynamic loading later without redesigning the boundary.
    for (const entry of ['snippet-dock', './ext.js', 'file:///tmp/x.js', 'data:text/js,']) {
      expect(validateManifest(manifest({ entry: entry as never }))?.rejection).toBe('invalid-entry')
    }
  })

  it('rejects a view id that is not a built-in', () => {
    expect(
      validateManifest(manifest({ views: ['custom-html-view' as never] }))?.rejection,
    ).toBe('unknown-view')
  })

  it('detects the platform from a user agent', () => {
    expect(currentExtensionPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe('macos')
    expect(currentExtensionPlatform('Mozilla/5.0 (Windows NT 10.0)')).toBe('windows')
    expect(currentExtensionPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux')
    // Unknown is not macOS and not Windows.
    expect(currentExtensionPlatform('something-else')).toBe('linux')
    expect(currentExtensionPlatform('')).toBe('linux')
  })

  it('reports whether a manifest supports the running platform', () => {
    const macOnly = manifest({ platforms: ['macos'] })
    expect(supportsPlatform(macOnly, 'macos')).toBe(true)
    expect(supportsPlatform(macOnly, 'windows')).toBe(false)
  })
})

describe('registration', () => {
  it('refuses a duplicate id', () => {
    // Two extensions under one id share a disposable bucket, so deactivating one
    // would clear the other's registrations.
    const registry = new ExtensionRegistry()
    expect(registry.register(manifest(), () => undefined)).toBeNull()
    expect(registry.register(manifest(), () => undefined)?.rejection).toBe('duplicate-id')
  })

  it('lists a registered extension as registered, not active', () => {
    const registry = new ExtensionRegistry()
    registry.register(manifest(), () => undefined)
    expect(registry.get('snippet-dock')?.status).toBe('registered')
  })

  it('returns undefined for an unknown id', () => {
    expect(new ExtensionRegistry().get('nope')).toBeUndefined()
  })
})

describe('enable and disable', () => {
  it('activates on enable and reports active', async () => {
    const registry = new ExtensionRegistry()
    registry.register(manifest(), () => undefined)
    await expect(registry.enable('snippet-dock')).resolves.toBe(true)
    expect(registry.get('snippet-dock')?.status).toBe('active')
  })

  it('refuses to activate on an unsupported platform', async () => {
    const registry = new ExtensionRegistry({ platform: 'windows' })
    registry.register(manifest({ platforms: ['macos'] }), () => undefined)
    await expect(registry.enable('snippet-dock')).resolves.toBe(false)
    expect(registry.get('snippet-dock')?.status).toBe('disabled')
  })

  it('returns false for an unknown id rather than throwing', async () => {
    await expect(new ExtensionRegistry().enable('nope')).resolves.toBe(false)
  })

  it('re-enabling an active extension does not register twice', async () => {
    // The double-registration failure: two copies of every command, so the palette
    // lists it twice and deactivating once leaves one behind.
    const register = vi.fn()
    const registry = new ExtensionRegistry()
    registry.register(manifest(), context => {
      register()
      void context
    })

    await registry.enable('snippet-dock')
    await registry.enable('snippet-dock')
    await registry.enable('snippet-dock')
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('returns every registration to baseline across enable/disable/enable', async () => {
    // The design's Level 2 question verbatim: command, menu, view and listener
    // counts must come back to where they started.
    const registry = new ExtensionRegistry()
    registry.register(manifest({ capabilities: [...manifest().capabilities, 'session.read-events'] }), context => {
      registerAll(context)
    })

    await registry.enable('snippet-dock')
    expect(registry.commands()).toHaveLength(1)

    await registry.deactivate('snippet-dock')
    expect(registry.commands()).toHaveLength(0)
    expect(registry.get('snippet-dock')?.status).toBe('disabled')

    await registry.enable('snippet-dock')
    expect(registry.commands()).toHaveLength(1)
  })

  it('exposes no commands while disabled', async () => {
    const registry = new ExtensionRegistry()
    registry.register(manifest(), context => {
      registerAll(context)
    })
    await registry.enable('snippet-dock')
    await registry.deactivate('snippet-dock')
    expect(registry.commands()).toEqual([])
  })
})

describe('partial activation', () => {
  it('rolls back everything it registered before the throw', async () => {
    // A half-activated extension is menu entries whose command belongs to a startup
    // that failed. Nothing it registered before the throw may survive.
    const registry = new ExtensionRegistry()
    registry.register(manifest(), context => {
      context.commands.register({ id: 'ext.a', titleKey: 'a', run: async () => null })
      context.menus.register({ location: 'terminal.context', commandId: 'ext.a' })
      throw new Error('activation blew up')
    })

    await expect(registry.enable('snippet-dock')).resolves.toBe(false)
    const record = registry.get('snippet-dock')
    expect(record?.status).toBe('failed')
    expect(record?.failure).toMatch(/blew up/)
    expect(registry.commands()).toEqual([])
  })

  it('can be retried after a failure', async () => {
    let attempt = 0
    const registry = new ExtensionRegistry()
    registry.register(manifest(), context => {
      attempt += 1
      if (attempt === 1) throw new Error('first attempt fails')
      registerAll(context)
    })

    await expect(registry.enable('snippet-dock')).resolves.toBe(false)
    await expect(registry.enable('snippet-dock')).resolves.toBe(true)
    expect(registry.commands()).toHaveLength(1)
  })
})

describe('deactivation with work in flight', () => {
  it('a callback captured before deactivate is refused afterwards', async () => {
    // The stale-generation case through the real registry: a handler kept a
    // reference to `context.terminal` and calls it after deactivate.
    const registry = new ExtensionRegistry()
    const gateway = new CapabilityGateway(
      (id: string) => registry.grantFor(id),
      {
        visibleSessionId: () => 'ssh-1',
        selectedText: () => ({ text: 'ls', selectionId: 's1', sessionId: 'ssh-1' }),
      },
    )
    registry.attachGateway(gateway)

    let captured: ExtensionContext['terminal'] | null = null
    registry.register(
      manifest({ capabilities: [...manifest().capabilities, 'terminal.read-selected'] }),
      context => {
        captured = context.terminal
      },
    )

    await registry.enable('snippet-dock')
    await expect(captured!.readSelectedText()).resolves.toBeTruthy()

    await registry.deactivate('snippet-dock')
    await expect(captured!.readSelectedText()).rejects.toMatchObject({
      denial: 'stale-generation',
    })
  })

  it('dropping the extension takes its approvals with it', async () => {
    const registry = new ExtensionRegistry()
    const gateway = new CapabilityGateway(
      (id: string) => registry.grantFor(id),
      {
        visibleSessionId: () => 'ssh-1',
        selectedText: () => ({ text: 'ls', selectionId: 's1', sessionId: 'ssh-1' }),
      },
    )
    registry.attachGateway(gateway)

    let captured: ExtensionContext['terminal'] | null = null
    registry.register(
      manifest({ capabilities: [...manifest().capabilities, 'terminal.read-selected'] }),
      context => {
        captured = context.terminal
      },
    )
    await registry.enable('snippet-dock')
    await captured!.requestSendText({ sessionId: 'ssh-1', text: 'ls' })
    expect(gateway.approvalCount()).toBe(1)

    await registry.deactivate('snippet-dock')
    expect(gateway.approvalCount()).toBe(0)
  })

  it('refuses terminal access when no gateway is attached', async () => {
    // Fails closed. A no-op would let an extension believe it read something.
    const registry = new ExtensionRegistry()
    let captured: ExtensionContext['terminal'] | null = null
    registry.register(
      manifest({ capabilities: [...manifest().capabilities, 'terminal.read-selected'] }),
      context => {
        captured = context.terminal
      },
    )
    await registry.enable('snippet-dock')
    await expect(captured!.readSelectedText()).rejects.toThrow(/gateway is not attached/)
  })
})

describe('events', () => {
  it('delivers to active subscribers only', async () => {
    const seen: string[] = []
    const registry = new ExtensionRegistry()
    registry.register(
      manifest({ capabilities: [...manifest().capabilities, 'session.read-events'] }),
      context => {
        context.events.on('session.connected', event => {
          seen.push(event.type)
        })
      },
    )

    registry.emit({ type: 'session.connected', at: 1 })
    expect(seen).toEqual([])

    await registry.enable('snippet-dock')
    registry.emit({ type: 'session.connected', at: 2 })
    expect(seen).toEqual(['session.connected'])

    await registry.deactivate('snippet-dock')
    registry.emit({ type: 'session.connected', at: 3 })
    expect(seen).toEqual(['session.connected'])
  })

  it('a throwing handler marks the extension failed without breaking the others', async () => {
    // The isolation requirement: one extension's exception does not stop the shell
    // or a sibling extension.
    const survivor: string[] = []
    const registry = new ExtensionRegistry()
    registry.register(
      manifest({ id: 'thrower', capabilities: ['session.read-events'] }),
      context => {
        context.events.on('session.connected', () => {
          throw new Error('handler exploded')
        })
      },
    )
    registry.register(
      manifest({ id: 'survivor', capabilities: ['session.read-events'] }),
      context => {
        context.events.on('session.connected', () => {
          survivor.push('ok')
        })
      },
    )

    await registry.enable('thrower')
    await registry.enable('survivor')
    registry.emit({ type: 'session.connected', at: 1 })

    expect(survivor).toEqual(['ok'])
    expect(registry.get('thrower')?.status).toBe('failed')
    expect(registry.get('survivor')?.status).toBe('active')
  })
})

/** Register one of each contribution kind, for counting. */
function registerAll(context: ExtensionContext): void {
  context.commands.register({ id: 'ext.a', titleKey: 'a', run: async () => null })
  context.menus.register({ location: 'terminal.context', commandId: 'ext.a' })
  context.views.register({ id: 'snippet-dock', titleKey: 'v' })
  context.events.on('session.connected', () => undefined)
}
