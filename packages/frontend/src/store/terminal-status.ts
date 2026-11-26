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
   * The CSS width the terminal was fitted to, when the pane could measure it.
   *
   * `cols` alone cannot tell the layout how wide a cell is — that is the number the
   * layout needs to decide whether a panel fits. Paired with `cols` it back-computes
   * the cell width xterm actually used, which is exact where the canvas estimate is
   * only as good as the font substitution on this machine. Absent is honest: a pane
   * that could not measure itself publishes nothing rather than a guess.
   */
  fittedWidth?: number
  /**
   * The session status the pane is actually in.
   *
   * Carried here rather than read from the tab: a tab exists whether or not its
   * session connected, so "tab present" is not a connection state.
   */
  status: 'idle' | 'connecting' | 'reconnecting' | 'connected' | 'disconnected' | 'error'
  /** Local / SSH / Serial, as the tab itself declares. */
  sessionType: 'local' | 'remote' | 'serial'
}

interface TerminalStatusState {
  active: TerminalStatusSnapshot | null
  /**
   * The fitted width of the *active* pane, mirrored out of `active`.
   *
   * Kept as its own slice so the layout can subscribe to it without subscribing to
   * `cols`/`rows` as well — a status-bar update on every resize should not re-render
   * the whole shell.
   */
  fittedWidth: number
  publish: (snapshot: TerminalStatusSnapshot) => void
  /** Clear only if the caller still owns the slot, so a late unmount cannot wipe
   * a newer pane's values. */
  clear: (tabId: string) => void
}

export const useTerminalStatusStore = create<TerminalStatusState>(set => ({
  active: null,
  fittedWidth: 0,
  publish: snapshot =>
    set(state => {
      /*
       * ## `?.` on the first access only was a crash, not a shorthand
       *
       * The version above compared `state.active?.tabId === snapshot.tabId &&` and then
       * read `state.active.cols` on the next line. When `active` is null — every publish
       * after the first `clear()`, which is what a background tab does — the optional
       * chain stops at `undefined === tabId` (false), so `&&` short-circuits and the
       * reads never happen. But it only short-circuits when the tab ids differ; the
       * moment they match with `active` null, `state.active.cols` throws.
       *
       * Measured on the macOS GUI run: the status bar never became readable, because
       * `publish` was throwing on every call.
       */
      const previous = state.active
      const unchanged =
        previous !== null &&
        previous.tabId === snapshot.tabId &&
        previous.cols === snapshot.cols &&
        previous.rows === snapshot.rows &&
        previous.status === snapshot.status &&
        previous.sessionType === snapshot.sessionType &&
        previous.fittedWidth === snapshot.fittedWidth
      if (unchanged) return state
      return {
        active: snapshot,
        fittedWidth: snapshot.fittedWidth ?? 0,
      }
    }),
  clear: tabId =>
    set(state =>
      /*
       * `fittedWidth` is cleared with the snapshot, not left behind.
       *
       * It is a copy of a field on `active`, so keeping it after `active` is gone would
       * leave the layout back-computing a cell width from a pane that no longer exists.
       */
      state.active?.tabId === tabId ? { active: null, fittedWidth: 0 } : state,
    ),
}))
