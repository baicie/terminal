/**
 * The first built-in extension: a Snippet Dock in the right column.
 *
 * ## Why this one first
 *
 * The design picks `snippet-dock` over a command explainer because it exercises a
 * real, already-existing workflow without binding UX-3 to the AI runtime that does
 * not exist yet (`06-ux3-extension-platform.md` §5). It needs exactly two things:
 * the existing Snippet service, and the user's selected terminal text — both of
 * which the app already has. It reads no credential, no scrollback, and makes no
 * network request.
 *
 * ## What it proves
 *
 * That the whole chain works end to end: manifest → registry → context → command,
 * menu, view and event registration → disable → nothing left behind. A registry
 * whose only extensions are test doubles has not been shown to work.
 *
 * ## What it deliberately does not do
 *
 * It does not execute anything. Saving a selection as a snippet stores text; running
 * a snippet is the existing Snippets view's job, with its own confirmation. And it
 * does not *send* the selection to a shell — capturing and running are different
 * actions, and only the user initiates the second.
 */

import { getSnippets } from '@/service/database/snippets'
import type { SnippetRecord } from '@/service/database/types'
import type { ExtensionContext } from './extension-registry-types'
import type { BuiltInExtensionManifest } from './extension-manifest'

export const SNIPPET_DOCK_EXTENSION_ID = 'snippet-dock'

export const snippetDockManifest: BuiltInExtensionManifest = {
  id: SNIPPET_DOCK_EXTENSION_ID,
  nameKey: 'extensions.snippetDock.name',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'built-in:snippet-dock',
  capabilities: [
    'commands.register',
    'menus.register',
    'ui.right-dock',
    'terminal.read-selected',
    'session.read-events',
  ],
  platforms: ['macos', 'windows', 'linux'],
  // Off until the user turns it on. The design requires that nothing optional runs
  // by default, and a dock that appears on first launch is UI nobody asked for.
  defaultEnabled: false,
  views: ['snippet-dock'],
}

/**
 * What the dock shows.
 *
 * A plain value the UI reads, not React state the extension owns: the extension
 * has no React, no component and no render access, which is what stops it from
 * becoming a UI framework in disguise.
 */
export interface SnippetDockState {
  snippets: SnippetRecord[]
  /** Set when the last load failed, so the dock can say so rather than look empty. */
  error: string | null
  /** The selection the "save as snippet" action would use, if any. */
  pendingDraft: { text: string, selectionId: string } | null
}

export interface SnippetDockHandle {
  state(): SnippetDockState
  /** Re-read from the database. */
  refresh(): Promise<void>
  /** Subscribe to state changes. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Capture the current selection as a draft, without storing or running it. */
  captureSelection(): Promise<boolean>
}

/**
 * The dock's model, created per activation.
 *
 * Returned from the factory so the UI can reach it; the extension itself holds no
 * module-level state, so a disable/enable cycle starts clean.
 */
export function createSnippetDock(
  context: ExtensionContext,
  loadSnippets: () => Promise<SnippetRecord[]> = getSnippets,
): SnippetDockHandle {
  let state: SnippetDockState = { snippets: [], error: null, pendingDraft: null }
  const listeners = new Set<() => void>()

  const setState = (next: Partial<SnippetDockState>) => {
    state = { ...state, ...next }
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // A broken subscriber must not stop the others from updating.
      }
    }
  }

  const refresh = async (): Promise<void> => {
    try {
      const snippets = await loadSnippets()
      setState({ snippets, error: null })
    } catch (error) {
      // An empty list and a failed read look identical in a dock. Saying which one
      // happened is the difference between "you have no snippets" and "the database
      // is unavailable", and only one of those is actionable.
      setState({ snippets: [], error: error instanceof Error ? error.message : String(error) })
    }
  }

  const captureSelection = async (): Promise<boolean> => {
    const selection = await context.terminal.readSelectedText()
    if (!selection) return false
    // Stored as a *draft* only. Saving is the existing Snippets view's job, where the
    // user names it and confirms; capturing here must not create a row.
    setState({ pendingDraft: { text: selection.text, selectionId: selection.selectionId } })
    return true
  }

  // Registrations go through the context bucket, so a deactivate takes them all with
  // it. A registration made outside the bucket is the leak deactivation exists to
  // prevent.
  context.commands.register({
    id: 'snippet-dock.open',
    titleKey: 'extensions.snippetDock.open',
    run: async () => {
      await refresh()
      return state.snippets.length
    },
  })
  context.commands.register({
    id: 'snippet-dock.capture-selection',
    titleKey: 'extensions.snippetDock.captureSelection',
    run: async () => captureSelection(),
  })
  context.menus.register({
    location: 'terminal.context',
    commandId: 'snippet-dock.capture-selection',
  })
  context.views.register({ id: 'snippet-dock', titleKey: 'extensions.snippetDock.name' })

  // A snippet edited in the Snippets view must not leave the dock showing stale
  // rows. Re-reading on a session change is a cheap, correct trigger; a database
  // subscription would need a service the design does not define yet.
  context.events.on('session.connected', () => {
    void refresh()
  })

  // An initial load, so the dock is not empty on first open. Deliberately not
  // awaited by the factory: activation must not depend on a database round trip.
  void refresh()

  return {
    state: () => state,
    refresh,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    captureSelection,
  }
}
