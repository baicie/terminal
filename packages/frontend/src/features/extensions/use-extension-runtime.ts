/**
 * The bridge between the extension registry and React.
 *
 * The registry is a plain object with a lifecycle; React needs something that
 * re-renders when it changes. This hook is that adapter and nothing more — it does
 * not own extension state, decide what is enabled, or implement any extension.
 *
 * ## Selection is not wired yet, and says so
 *
 * `selectedText()` returns `null` because there is no global surface that reports the
 * terminal's current selection. That is the safe default — an extension cannot read
 * text nobody registered — but it means `captureSelection` returns false today. The
 * alternative, publishing a selection from somewhere that only *approximates* what
 * the user highlighted, would hand extensions text the user did not choose, which is
 * the specific thing `terminal.read-selected` exists to prevent.
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

/** One registry for the process, mirroring `vaultService` and `providerRegistry`. */
export function getExtensionRegistry(): ExtensionRegistry {
  if (registrySingleton) return registrySingleton
  const registry = new ExtensionRegistry()
  registry.register(snippetDockManifest, context => {
    snippetDockHandle = createSnippetDock(context)
  })

  const gateway = new CapabilityGateway(
    extensionId => registry.grantFor(extensionId),
    {
      // The active tab is the session the user can see. Not "the last session that
      // connected": a background reconnect must not become the target of a capture.
      visibleSessionId: () => useAppStore.getState().activeTabId ?? null,
      selectedText: () => null,
    },
  )
  registry.attachGateway(gateway)
  registrySingleton = registry
  return registry
}

/** Test-only: drop the singleton so a suite starts from a clean registry. */
export function __resetExtensionRegistryForTests(): void {
  registrySingleton = null
  snippetDockHandle = null
}

export function useExtensionRuntime(): ExtensionRuntime {
  const registry = getExtensionRegistry()
  const [, forceRender] = useState(0)
  const registryRef = useRef(registry)

  // The registry has no subscription API — it reports changes through
  // `onChanged`. Re-rendering on mount and after each explicit action is enough for
  // the surfaces that exist; a subscription would be the right answer once a settings
  // page lists live status.
  useEffect(() => {
    forceRender(value => value + 1)
  }, [])

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
