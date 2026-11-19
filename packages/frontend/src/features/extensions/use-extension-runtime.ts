/**
 * The bridge between the extension registry and React.
 *
 * The registry is a plain object with a lifecycle; React needs something that
 * re-renders when it changes. This hook is that adapter and nothing more — it does
 * not own extension state, decide what is enabled, or implement any extension.
 *
 * ## Selection comes from the active terminal, not from a guess
 *
 * `selectedText()` reads what `TerminalContainer` published via
 * `publishTerminalSelection`, which is `term.getSelection()` on the *active* tab — the
 * same call the context menu's Copy uses. A background tab publishes nothing, so an
 * extension cannot read text the user highlighted on a host they have since left.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { CapabilityGateway } from '@/features/extensions/capability-gateway'
import { ExtensionRegistry } from '@/features/extensions/extension-registry'
import {
  SNIPPET_DOCK_EXTENSION_ID,
  createSnippetDock,
  snippetDockManifest,
  type SnippetDockHandle,
} from '@/features/extensions/snippet-dock-extension'
import { useAppStore } from '@/store/app'
import { currentTerminalSelection } from '@/features/terminal/services/terminal-selection'

export interface ExtensionRuntime {
  /** Non-null only while `snippet-dock` is active. */
  snippetDock: SnippetDockHandle | null
  enable(extensionId: string): Promise<boolean>
  disable(extensionId: string): Promise<void>
  /** Which extensions are active, for a settings page. */
  activeIds(): string[]
}

let registrySingleton: ExtensionRegistry | null = null
let snippetDockHandle: SnippetDockHandle | null = null

/**
 * Listeners told whenever any extension's activation changes.
 *
 * ## Why a module-level set rather than a registry field
 *
 * The registry already accepts an `onChanged` callback, but it is fixed at
 * construction and single-valued. Three different parts of the tree need to react:
 * the Settings page (to re-render the switches), the right panel (to mount or unmount
 * the dock) and the terminal's context menu (to gain or lose its extension entries).
 *
 * ## Why the registry's own `onChanged` drives this
 *
 * Wired at construction below, so *every* activation path notifies — not just the two
 * the hook happens to wrap. Measured on a real WebView run: the Settings switch called
 * `applyEnabledExtensions`, which calls `registry.enable()` directly, so a notify
 * placed in `useExtensionRuntime().enable` never fired. The switch flipped, the
 * registry activated, and the dock still rendered "turned off" while the context menu
 * still had no extension entry.
 */
const activationListeners = new Set<() => void>()

/** Notify every listener, containing one that throws. */
function notifyActivationChanged(): void {
  for (const listener of activationListeners) {
    try {
      listener()
    } catch {
      // One broken subscriber must not stop the others or the activation itself.
    }
  }
}

/** Subscribe to activation changes. Returns an unsubscribe. */
export function subscribeExtensionActivations(listener: () => void): () => void {
  activationListeners.add(listener)
  return () => {
    activationListeners.delete(listener)
  }
}

/** One registry for the process, mirroring `vaultService` and `providerRegistry`. */
export function getExtensionRegistry(): ExtensionRegistry {
  if (registrySingleton) return registrySingleton
  const registry = new ExtensionRegistry({ onChanged: notifyActivationChanged })
  registry.register(snippetDockManifest, context => {
    /*
     * Returned, not just assigned.
     *
     * The registry settles a deactivation by running every disposable the factory
     * handed back. This factory used to be a block body with no `return`, so the handle
     * — its listeners, its pending draft and its in-flight refresh — kept living after
     * the extension was disabled, and nothing outside the handle could tell.
     *
     * Measured before the fix: the disposable bucket held exactly the five
     * registrations and no handle at all.
     */
    const handle = createSnippetDock(context)
    snippetDockHandle = handle
    return {
      dispose: () => {
        // Only clear the module-level pointer if it still points at *this* activation.
        // A disable followed by a quick enable creates a second handle, and the first
        // one's rollback must not wipe the pointer to the second.
        if (snippetDockHandle === handle) snippetDockHandle = null
        handle.dispose()
      },
    }
  })

  const gateway = new CapabilityGateway(
    extensionId => registry.grantFor(extensionId),
    {
      // The active tab is the session the user can see. Not "the last session that
      // connected": a background reconnect must not become the target of a capture.
      visibleSessionId: () => useAppStore.getState().activeTabId ?? null,
      selectedText: () => {
        const published = currentTerminalSelection()
        if (!published) return null
        // The tab the user is looking at must be the tab that published it. Two
        // independent sources agreeing is what makes "currently selected" true
        // rather than merely recent.
        const activeTabId = useAppStore.getState().activeTabId
        if (!activeTabId || published.sessionId !== activeTabId) return null
        return {
          text: published.text,
          // The publisher's sequence, not the tab id: within one tab the user can
          // select, select something else, and come back to the first text. An
          // approval minted for the first must not authorise the third.
          selectionId: `selection-${published.seq}`,
          sessionId: published.sessionId,
        }
      },
    },
  )
  registry.attachGateway(gateway)
  // ## A read-only snapshot for the GUI E2E probe
  //
  // The switch and the registry can disagree — a switch rendering "checked" while the
  // registry still has the extension disabled is a defect, and a spec that only reads
  // the switch would call it working. Gated on the same build flag as the probe, so a
  // production bundle never defines it.
  if (import.meta.env.VITE_TERMINAL_GUI_E2E === '1') {
    ;(globalThis as { __terminalExtensionProbe?: () => unknown }).__terminalExtensionProbe =
      () => ({
        active: registry
          .list()
          .filter(record => record.status === 'active')
          .map(record => record.manifest.id),
        snippetDockHandle: snippetDockHandle !== null,
        menus: registry.menusFor('terminal.context').map(menu => menu.commandId),
      })
  }

  registrySingleton = registry
  return registry
}

/** Test-only: drop the singleton so a suite starts from a clean registry. */
export function __resetExtensionRegistryForTests(): void {
  registrySingleton = null
  snippetDockHandle = null
  activationListeners.clear()
}

/**
 * Test-only: the handle the current activation created.
 *
 * A test that wants to prove the *production factory* hands its handle to the registry
 * cannot build one itself — the defect being guarded against is precisely that the
 * factory did not return it. Reading the live handle is what makes the assertion about
 * the real assembly rather than about a `Disposable` the test constructed.
 */
export function __currentSnippetDockForTests(): SnippetDockHandle | null {
  return snippetDockHandle
}

export function useExtensionRuntime(): ExtensionRuntime {
  const registry = getExtensionRegistry()
  const [, forceRender] = useState(0)
  const registryRef = useRef(registry)

  // Re-render when *any* path changes activation — the Settings switch calls
  // `applyEnabledExtensions`, which drives the registry directly, so reacting only to
  // this hook's own `enable`/`disable` leaves the panel showing a retired state.
  useEffect(() => subscribeExtensionActivations(() => forceRender(value => value + 1)), [])

  const enable = useCallback(async (extensionId: string) => {
    const ok = await registryRef.current.enable(extensionId)
    forceRender(value => value + 1)
    return ok
  }, [])

  const disable = useCallback(async (extensionId: string) => {
    await registryRef.current.deactivate(extensionId)
    if (extensionId === SNIPPET_DOCK_EXTENSION_ID) snippetDockHandle = null
    forceRender(value => value + 1)
  }, [])

  const activeIds = useCallback(
    () =>
      registryRef.current
        .list()
        .filter(record => record.status === 'active')
        .map(record => record.manifest.id),
    [],
  )

  const active =
    registryRef.current.get(SNIPPET_DOCK_EXTENSION_ID)?.status === 'active'

  return {
    snippetDock: active ? snippetDockHandle : null,
    enable,
    disable,
    activeIds,
  }
}
