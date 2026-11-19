// A context menu mounted before an extension is enabled must gain its entry.
//
// Measured on the macOS CI run: the Settings switch flipped to "checked",
// `registry.menusFor('terminal.context')` returned `snippet-dock.capture-selection`,
// and the terminal's context menu still rendered Copy / Paste / Select All / Clear /
// Find / Zoom with **no extension entry** — so the dock could be opened but a selected
// text could never be captured. The component read the registry during render and
// nothing re-rendered it after the activation.
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const registry = {
  commands: vi.fn(() => [] as Array<{ id: string, titleKey: string, run: () => Promise<unknown> }>),
  menusFor: vi.fn(() => [] as Array<{ extensionId: string, commandId: string, titleKey: string }>),
}
let activations: Array<() => void> = []

vi.mock('@/features/extensions/use-extension-runtime', () => ({
  getExtensionRegistry: () => registry,
  subscribeExtensionActivations: (listener: () => void) => {
    activations.push(listener)
    return () => {
      activations = activations.filter(entry => entry !== listener)
    }
  },
}))

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenuItem: ({ children, onSelect }: { children: React.ReactNode, onSelect?: () => void }) => (
    <button type="button" role="menuitem" onClick={onSelect}>
      {children}
    </button>
  ),
  ContextMenuSeparator: () => <hr />,
}))

import { ExtensionMenuItems } from '@/features/terminal/components/terminal-container/extension-menu-items'

/** Simulate the registry gaining an entry, then notify subscribers. */
function enableExtension() {
  registry.commands.mockReturnValue([
    { id: 'snippet-dock.capture-selection', titleKey: 'extensions.snippetDock.captureSelection', run: async () => undefined },
  ])
  registry.menusFor.mockReturnValue([
    { extensionId: 'snippet-dock', commandId: 'snippet-dock.capture-selection', titleKey: 'extensions.snippetDock.captureSelection' },
  ])
  act(() => {
    for (const listener of activations) listener()
  })
}

describe('extension menu entries appear after an activation', () => {
  beforeEach(() => {
    activations = []
    registry.commands.mockReturnValue([])
    registry.menusFor.mockReturnValue([])
  })

  it('re-renders with the new entry when the extension is enabled later', () => {
    render(<ExtensionMenuItems />)
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)

    enableExtension()

    expect(
      screen.getAllByRole('menuitem'),
      'a menu mounted before the activation must gain the entry, or the extension is unreachable from the surface it registers for',
    ).toHaveLength(1)
  })

  it('drops the entry when the extension is disabled again', () => {
    registry.commands.mockReturnValue([
      { id: 'snippet-dock.capture-selection', titleKey: 'k', run: async () => undefined },
    ])
    registry.menusFor.mockReturnValue([
      { extensionId: 'snippet-dock', commandId: 'snippet-dock.capture-selection', titleKey: 'k' },
    ])
    render(<ExtensionMenuItems />)
    expect(screen.getAllByRole('menuitem')).toHaveLength(1)

    registry.commands.mockReturnValue([])
    registry.menusFor.mockReturnValue([])
    act(() => {
      for (const listener of activations) listener()
    })
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
  })

  it('unsubscribes on unmount', () => {
    const view = render(<ExtensionMenuItems />)
    expect(activations).toHaveLength(1)
    view.unmount()
    expect(activations).toHaveLength(0)
  })
})
