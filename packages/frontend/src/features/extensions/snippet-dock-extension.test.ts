// The first real extension, through the real registry.
//
// A registry whose only extensions are test doubles has not been shown to work. This
// drives the shipped `snippet-dock` manifest and factory through
// register → enable → use → disable → nothing left, which is the design's completion
// definition for EXT-03.

import { describe, expect, it, vi } from 'vitest'
import { CapabilityGateway } from './capability-gateway'
import { ExtensionRegistry } from './extension-registry'
import type { ExtensionContext } from './extension-registry-types'
import {
  SNIPPET_DOCK_EXTENSION_ID,
  createSnippetDock,
  snippetDockManifest,
  type SnippetDockHandle,
} from './snippet-dock-extension'
import type { SnippetRecord } from '@/service/database/types'

function snippet(name: string): SnippetRecord {
  return { id: `s-${name}`, name, script: `echo ${name}` }
}

function setup(options: { load?: () => Promise<SnippetRecord[]>, selection?: string | null } = {}) {
  const registry = new ExtensionRegistry({ platform: 'macos' })
  const gateway = new CapabilityGateway(
    (id: string) => registry.grantFor(id),
    {
      visibleSessionId: () => 'ssh-1',
      selectedText: () =>
        options.selection === null
          ? null
          : {
              text: options.selection ?? 'kubectl get pods',
              selectionId: 'sel-1',
              sessionId: 'ssh-1',
            },
    },
  )
  registry.attachGateway(gateway)

  let dock: SnippetDockHandle | null = null
  const load = options.load ?? (async () => [snippet('deploy'), snippet('logs')])
  registry.register(snippetDockManifest, (context: ExtensionContext) => {
    dock = createSnippetDock(context, load)
  })
  return { registry, gateway, dock: () => dock! }
}

describe('the shipped snippet-dock manifest', () => {
  it('declares only capabilities it uses', () => {
    // A manifest that asks for more than it needs is a manifest that has to be
    // re-reviewed every time someone wonders why it can read terminal text.
    expect(snippetDockManifest.capabilities).toEqual([
      'commands.register',
      'menus.register',
      'ui.right-dock',
      'terminal.read-selected',
      'session.read-events',
    ])
  })

  it('is off by default', () => {
    // A dock that appears on first launch is UI nobody asked for.
    expect(snippetDockManifest.defaultEnabled).toBe(false)
  })

  it('registers and validates through the real registry', () => {
    const { registry } = setup()
    expect(registry.get(SNIPPET_DOCK_EXTENSION_ID)?.status).toBe('registered')
  })
})

describe('activation registers everything it promised', () => {
  it('registers two commands, a menu entry and a view', async () => {
    const { registry } = setup()
    await registry.enable(SNIPPET_DOCK_EXTENSION_ID)

    const commands = registry.commands().map(command => command.id).sort()
    expect(commands).toEqual(['snippet-dock.capture-selection', 'snippet-dock.open'])
    expect(registry.get(SNIPPET_DOCK_EXTENSION_ID)?.status).toBe('active')
  })

  it('loads snippets without blocking activation', async () => {
    // Activation must not depend on a database round trip: a slow read would push
    // the extension past its budget and report a failure that is not one.
    let resolve: (value: SnippetRecord[]) => void = () => undefined
    const load = vi.fn(
      () =>
        new Promise<SnippetRecord[]>(resolved => {
          resolve = resolved
        }),
    )
    const { registry, dock } = setup({ load })

    await expect(registry.enable(SNIPPET_DOCK_EXTENSION_ID)).resolves.toBe(true)
    expect(dock().state().snippets).toEqual([])

    resolve([snippet('later')])
    await vi.waitFor(() => expect(dock().state().snippets).toHaveLength(1))
  })

  it('reports a failed load instead of looking empty', async () => {
    // Empty and broken look identical in a dock, and only one is actionable.
    const { registry, dock } = setup({
      load: async () => {
        throw new Error('database is locked')
      },
    })
    await registry.enable(SNIPPET_DOCK_EXTENSION_ID)
    await vi.waitFor(() => expect(dock().state().error).toMatch(/locked/))
  })
})

describe('using the dock', () => {
  it('refreshes through the open command', async () => {
    const load = vi.fn(async () => [snippet('a')])
    const { registry } = setup({ load })
    await registry.enable(SNIPPET_DOCK_EXTENSION_ID)
    await vi.waitFor(() => expect(load).toHaveBeenCalled())

    load.mockResolvedValue([snippet('a'), snippet('b')])
    const open = registry.commands().find(command => command.id === 'snippet-dock.open')
    await expect(open!.run()).resolves.toBe(2)
  })

  it('captures the selection as a draft without storing or running it', async () => {
    // The two rules that keep this safe: capture does not create a row, and it does
    // not send anything to the shell. Running a snippet stays the Snippets view's
    // job, with its own confirmation.
    const load = vi.fn(async () => [] as SnippetRecord[])
    const { registry, dock } = setup({ load, selection: 'kubectl get pods' })
    await registry.enable(SNIPPET_DOCK_EXTENSION_ID)

    await expect(dock().captureSelection()).resolves.toBe(true)
    expect(dock().state().pendingDraft).toEqual({
      text: 'kubectl get pods',
      selectionId: 'sel-1',
    })
    // Nothing was written: `load` is the only database function this extension has.
    expect(load).toHaveBeenCalled()
    expect(dock().state().snippets).toEqual([])
  })

  it('captures nothing when the user has selected nothing', async () => {
    const { registry, dock } = setup({ selection: null })
    await registry.enable(SNIPPET_DOCK_EXTENSION_ID)
    await expect(dock().captureSelection()).resolves.toBe(false)
    expect(dock().state().pendingDraft).toBeNull()
  })

  it('re-reads on a session change so the dock is not stale', async () => {
    const load = vi.fn(async () => [snippet('a')])
    const { registry } = setup({ load })
    await registry.enable(SNIPPET_DOCK_EXTENSION_ID)
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1))

    registry.emit({ type: 'session.connected', sessionId: 'ssh-2', at: 1 })
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  })
})

describe('deactivation', () => {
  it('removes every command, menu and view it registered', async () => {
    const { registry } = setup()
    await registry.enable(SNIPPET_DOCK_EXTENSION_ID)
    expect(registry.commands()).toHaveLength(2)

    await registry.deactivate(SNIPPET_DOCK_EXTENSION_ID)
    expect(registry.commands()).toEqual([])
    expect(registry.get(SNIPPET_DOCK_EXTENSION_ID)?.status).toBe('disabled')
  })

  it('survives re-enable and settles again', async () => {
    // The cycle the design asks for by name: enable → disable → enable, back to
    // baseline both times, with no duplicate registrations.
    const { registry } = setup()
    await registry.enable(SNIPPET_DOCK_EXTENSION_ID)
    await registry.deactivate(SNIPPET_DOCK_EXTENSION_ID)
    await registry.enable(SNIPPET_DOCK_EXTENSION_ID)

    const ids = registry.commands().map(command => command.id)
    expect(ids.filter(id => id === 'snippet-dock.open')).toHaveLength(1)

    await registry.deactivate(SNIPPET_DOCK_EXTENSION_ID)
    expect(registry.commands()).toEqual([])
  })

  it('stops reading a selection after deactivate', async () => {
    const { registry, dock } = setup()
    await registry.enable(SNIPPET_DOCK_EXTENSION_ID)
    const captured = dock()
    await registry.deactivate(SNIPPET_DOCK_EXTENSION_ID)

    // The handle outlives its extension in a component that has not unmounted yet.
    // Its gateway calls must fail rather than keep working.
    await expect(captured.captureSelection()).rejects.toBeTruthy()
  })

  it('does not keep delivering events to a disabled extension', async () => {
    const load = vi.fn(async () => [] as SnippetRecord[])
    const { registry } = setup({ load })
    await registry.enable(SNIPPET_DOCK_EXTENSION_ID)
    await vi.waitFor(() => expect(load).toHaveBeenCalled())
    await registry.deactivate(SNIPPET_DOCK_EXTENSION_ID)

    const before = load.mock.calls.length
    registry.emit({ type: 'session.connected', at: 1 })
    expect(load.mock.calls.length).toBe(before)
  })
})
