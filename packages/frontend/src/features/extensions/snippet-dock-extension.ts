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
import type { Disposable } from './extension-types'
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

/**
 * The dock's model, created per activation.
 *
 * ## Why the handle is a `Disposable`
 *
 * Returned from the factory so the registry can own it. The registry already settles a
 * deactivation by running every disposable an activation handed it; a handle outside
 * that bucket kept its listeners, its pending draft and its in-flight `refresh` alive
 * after the extension was disabled, and none of it was visible from `status`.
 *
 * `dispose` is idempotent: a rollback after a failed activation and an explicit
 * deactivation can both reach the same handle, and the second call must not repeat
 * side effects.
 */
export interface SnippetDockHandle extends Disposable {
  state(): SnippetDockState
  /** Re-read from the database. Refuses once the handle is disposed. */
  refresh(): Promise<void>
  /** Subscribe to state changes. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Capture the current selection as a draft, without storing or running it. */
  captureSelection(): Promise<boolean>
  /**
   * Drop the draft.
   *
   * The dock offers this because a captured draft that can only be saved is a trap: the
   * user who captured the wrong text has to save it somewhere and then delete it from
   * the Snippets page. Clearing is one state change, and it is the only cleanup path the
   * draft has.
   */
  discardDraft(): void
  /** Whether this handle was disposed. The UI uses it to stop offering actions. */
  readonly disposed: boolean
}

export function createSnippetDock(
  context: ExtensionContext,
  loadSnippets: () => Promise<SnippetRecord[]> = getSnippets,
): SnippetDockHandle {
  let state: SnippetDockState = { snippets: [], error: null, pendingDraft: null }
  const listeners = new Set<() => void>()
  /**
   * Generation of this activation.
   *
   * An async `refresh` that started before the handle was disposed must not publish its
   * result: the dock it was loading for no longer exists, and writing into the shared
   * state would make a disabled extension appear to update. Captured per call rather
   * than compared to a boolean so a result from an older activation cannot overwrite a
   * newer one either.
   */
  let generation = 0
  let disposed = false

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
    /*
     * Refused at the door, not only on the way back.
     *
     * The checks after the await stop a *stale result* from being published, but they
     * run after the read has already happened. Measured: two `refresh()` calls on a
     * disposed handle still issued three loader calls — a disabled extension reading
     * the database on behalf of a dock that no longer exists.
     */
    if (disposed) return
    // Captured before the await: this is the activation the result belongs to.
    const startedIn = generation
    try {
      const snippets = await loadSnippets()
      // Disposed, or a newer activation took over while the read was in flight. Either
      // way this result describes a dock nobody is looking at.
      if (disposed || startedIn !== generation) return
      setState({ snippets, error: null })
    } catch (error) {
      if (disposed || startedIn !== generation) return
      // An empty list and a failed read look identical in a dock. Saying which one
      // happened is the difference between "you have no snippets" and "the database
      // is unavailable", and only one of those is actionable.
      setState({ snippets: [], error: error instanceof Error ? error.message : String(error) })
    }
  }

  const captureSelection = async (): Promise<boolean> => {
    if (disposed) return false
    const selection = await context.terminal.readSelectedText()
    if (!selection) return false
    // The read is a gateway call, so the extension can be disabled while it is in
    // flight — the gateway refuses a stale generation, but this handle also has to
    // refuse to write a draft into a model that is already gone.
    if (disposed) return false
    // Stored as a *draft* only. Saving is the existing Snippets view's job, where the
    // user names it and confirms; capturing here must not create a row.
    setState({ pendingDraft: { text: selection.text, selectionId: selection.selectionId } })
    return true
  }

  const discardDraft = (): void => {
    if (disposed) return
    setState({ pendingDraft: null })
  }

  /**
   * Settle this activation.
   *
   * Idempotent: the registry can reach the same handle from a failed-activation
   * rollback and from an explicit deactivation, and a second call must not repeat the
   * side effects or invalidate a newer activation's generation.
   *
   * It deliberately does not touch the terminal, SSH or SFTP: the dock is a sibling of
   * the terminal tree, and closing it is a presentation change.
   */
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    // Bumping the generation is what makes an in-flight `refresh` recognise that its
    // result describes a dock that no longer exists.
    generation += 1
    // A pending draft is the user's selection, held only for as long as this
    // activation lives. It must not survive into the next one.
    state = { snippets: state.snippets, error: state.error, pendingDraft: null }
    // Dropped before notifying: a listener that re-subscribes during teardown must not
    // be resurrected into a set this handle will never notify again.
    listeners.clear()
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
      // A disposed handle has nothing left to publish; handing back a no-op keeps the
      // "returns an unsubscribe" contract without adding to a set that is never read.
      if (disposed) return () => undefined
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    captureSelection,
    discardDraft,
    dispose,
    get disposed() {
      return disposed
    },
  }
}
