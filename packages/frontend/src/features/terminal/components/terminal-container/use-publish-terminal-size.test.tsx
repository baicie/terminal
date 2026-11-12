// UX-1a review — the status bar must follow xterm, not the browser window.
//
// The previous implementation listened on `window.resize`. That covers exactly one
// of the ways a terminal changes size: a split-sash drag, opening/closing the
// sidebar and the font-zoom shortcuts all call `fit()` without the window moving.
// The status bar then kept printing a column count the PTY no longer had.
//
// These tests drive `onResize` — the event xterm itself fires from `Terminal.resize()`
// — so they exercise the real data path rather than the props `StatusBar` receives.

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalStatusStore } from '@/store/terminal-status'
import {
  usePublishTerminalSize,
  type SizeReportingTerminal,
} from './use-publish-terminal-size'

type ResizeHandler = (size: { cols: number, rows: number }) => void

/**
 * A stand-in that behaves like the xterm surface this hook is allowed to use.
 * `resize()` is what `fitAddon.fit()` ends up calling, and it is what must reach
 * the store.
 */
function createTerminal(cols: number, rows: number) {
  const handlers = new Set<ResizeHandler>()
  let disposed = 0
  let current = { cols, rows }
  const terminal: SizeReportingTerminal = {
    get cols() {
      return current.cols
    },
    get rows() {
      return current.rows
    },
    onResize: vi.fn((handler: ResizeHandler) => {
      handlers.add(handler)
      return {
        dispose: vi.fn(() => {
          disposed += 1
          handlers.delete(handler)
        }),
      }
    }),
  }
  return {
    terminal,
    get disposed() {
      return disposed
    },
    get listenerCount() {
      return handlers.size
    },
    /** What FitAddon does: change dimensions, then emit. */
    resize(nextCols: number, nextRows: number) {
      current = { cols: nextCols, rows: nextRows }
      for (const handler of handlers) handler({ cols: nextCols, rows: nextRows })
    },
  }
}

function renderPublisher(
  options: Partial<Parameters<typeof usePublishTerminalSize>[0]> & {
    term: SizeReportingTerminal | null
  },
) {
  return renderHook(
    (props: Parameters<typeof usePublishTerminalSize>[0]) =>
      usePublishTerminalSize(props),
    {
      initialProps: {
        tabId: 'tab-1',
        isActive: true,
        isReady: true,
        status: 'connected' as const,
        sessionType: 'remote' as const,
        ...options,
      },
    },
  )
}

describe('usePublishTerminalSize follows xterm resize events', () => {
  beforeEach(() => {
    useTerminalStatusStore.setState({ active: null })
  })

  it('publishes the initial size the terminal reports', () => {
    const stub = createTerminal(120, 30)
    renderPublisher({ term: stub.terminal })
    expect(useTerminalStatusStore.getState().active).toEqual({
      tabId: 'tab-1',
      cols: 120,
      rows: 30,
      status: 'connected',
      sessionType: 'remote',
    })
  })

  it('updates when xterm resizes without a window resize', () => {
    // The regression: a split-sash drag or a sidebar toggle changes the terminal
    // geometry and the window never moves. `window.resize` never fires, so the
    // old implementation froze on the pre-drag columns.
    const stub = createTerminal(120, 30)
    renderPublisher({ term: stub.terminal })

    act(() => stub.resize(80, 24))

    expect(useTerminalStatusStore.getState().active).toMatchObject({
      cols: 80,
      rows: 24,
    })
  })

  it('keeps following resize after several fits', () => {
    const stub = createTerminal(120, 30)
    renderPublisher({ term: stub.terminal })

    act(() => stub.resize(100, 28))
    act(() => stub.resize(160, 44))
    act(() => stub.resize(142, 43))

    expect(useTerminalStatusStore.getState().active).toMatchObject({
      cols: 142,
      rows: 43,
    })
  })

  it('releases the subscription when the terminal is disposed', () => {
    const stub = createTerminal(120, 30)
    const { unmount } = renderPublisher({ term: stub.terminal })
    expect(stub.listenerCount).toBe(1)

    unmount()

    expect(stub.disposed).toBe(1)
    expect(stub.listenerCount).toBe(0)
  })

  it('releases the subscription when a new terminal replaces the old one', () => {
    // The session layer swaps the xterm instance on a reconnect. A listener left
    // on the disposed instance never fires again, and one left on a live instance
    // would let a stale terminal write the status bar.
    const first = createTerminal(120, 30)
    const { rerender } = renderPublisher({ term: first.terminal })
    const second = createTerminal(140, 40)

    rerender({
      tabId: 'tab-1',
      isActive: true,
      isReady: true,
      term: second.terminal,
      status: 'connected',
      sessionType: 'remote',
    })

    expect(first.disposed).toBe(1)
    expect(first.listenerCount).toBe(0)
    expect(useTerminalStatusStore.getState().active).toMatchObject({
      cols: 140,
      rows: 40,
    })
  })

  it('a background pane never overwrites the visible pane', () => {
    // A split renders two live panes. The hidden one keeps resizing when the sash
    // moves; reporting it would make the status bar describe a terminal the user
    // cannot see.
    const active = createTerminal(120, 30)
    const hidden = createTerminal(60, 30)
    const activePane = renderPublisher({ tabId: 'tab-active', term: active.terminal })
    const hiddenPane = renderPublisher({
      tabId: 'tab-hidden',
      isActive: false,
      term: hidden.terminal,
    })

    expect(useTerminalStatusStore.getState().active?.tabId).toBe('tab-active')
    expect(hidden.terminal.onResize).not.toHaveBeenCalled()

    act(() => hidden.resize(40, 20))
    expect(useTerminalStatusStore.getState().active).toMatchObject({
      tabId: 'tab-active',
      cols: 120,
    })

    // And when the user switches to the other tab, the new pane takes the slot.
    activePane.rerender({
      tabId: 'tab-active',
      isActive: false,
      isReady: true,
      term: active.terminal,
      status: 'connected',
      sessionType: 'remote',
    })
    hiddenPane.rerender({
      tabId: 'tab-hidden',
      isActive: true,
      isReady: true,
      term: hidden.terminal,
      status: 'connected',
      sessionType: 'remote',
    })
    expect(useTerminalStatusStore.getState().active).toMatchObject({
      tabId: 'tab-hidden',
      cols: 40,
      rows: 20,
    })
  })

  it('does not show the previous tab size after switching', () => {
    // The old tab's listener must be gone; otherwise a late fit from the pane the
    // user just left lands in the slot the new pane owns.
    const previous = createTerminal(200, 50)
    const { rerender } = renderPublisher({ tabId: 'tab-old', term: previous.terminal })

    const next = createTerminal(90, 25)
    rerender({
      tabId: 'tab-new',
      isActive: true,
      isReady: true,
      term: next.terminal,
      status: 'connected',
      sessionType: 'remote',
    })

    expect(previous.listenerCount).toBe(0)
    act(() => previous.resize(200, 50))
    expect(useTerminalStatusStore.getState().active).toMatchObject({
      tabId: 'tab-new',
      cols: 90,
      rows: 25,
    })
  })

  it('clears the slot when the pane unmounts while active', () => {
    const stub = createTerminal(120, 30)
    const { unmount } = renderPublisher({ term: stub.terminal })
    expect(useTerminalStatusStore.getState().active).not.toBeNull()

    unmount()

    expect(useTerminalStatusStore.getState().active).toBeNull()
  })

  it('refuses a zero size, which xterm reports before the first fit', () => {
    const stub = createTerminal(0, 0)
    renderPublisher({ term: stub.terminal })
    expect(useTerminalStatusStore.getState().active).toBeNull()
  })

  it('re-reports the same size when the session state changes', () => {
    // A reconnect keeps the geometry but changes the status; the status bar must
    // not stay on the old state until the next resize.
    const stub = createTerminal(120, 30)
    const { rerender } = renderPublisher({ term: stub.terminal, status: 'connecting' })

    rerender({
      tabId: 'tab-1',
      isActive: true,
      isReady: true,
      term: stub.terminal,
      status: 'connected',
      sessionType: 'remote',
    })

    expect(useTerminalStatusStore.getState().active).toMatchObject({
      cols: 120,
      status: 'connected',
    })
  })
})
