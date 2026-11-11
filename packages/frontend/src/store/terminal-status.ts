import { create } from 'zustand'

/**
 * What the active terminal pane reports about itself, for the status bar.
 *
 * A separate store rather than lifting state into the layout: the size lives in
 * the xterm instance inside `TerminalContainer`, which is rendered by the
 * always-mounted terminal layer, not by the layout. Prop-drilling it would mean
 * threading a value through a component tree that deliberately does not re-render
 * on layout changes.
 *
 * Only the *active* tab publishes. A background pane keeps running and its size
 * keeps changing, but reporting a hidden pane's columns would be a lie in the one
 * place the user looks for the truth.
 */
export interface TerminalStatusSnapshot {
  tabId: string
  cols: number
  rows: number
  /**
   * The session status the pane is actually in.
   *
   * Carried here rather than read from the tab: a tab exists whether or not its
   * session connected, so "tab present" is not a connection state.
   */
  status: 'idle' | 'connecting' | 'reconnecting' | 'connected' | 'disconnected' | 'error'
}

interface TerminalStatusState {
  active: TerminalStatusSnapshot | null
  publish: (snapshot: TerminalStatusSnapshot) => void
  /** Clear only if the caller still owns the slot, so a late unmount cannot wipe
   * a newer pane's values. */
  clear: (tabId: string) => void
}

export const useTerminalStatusStore = create<TerminalStatusState>(set => ({
  active: null,
  publish: snapshot =>
    set(state =>
      state.active?.tabId === snapshot.tabId &&
      state.active.cols === snapshot.cols &&
      state.active.rows === snapshot.rows &&
      state.active.status === snapshot.status
        ? state
        : { active: snapshot },
    ),
  clear: tabId =>
    set(state => (state.active?.tabId === tabId ? { active: null } : state)),
}))
