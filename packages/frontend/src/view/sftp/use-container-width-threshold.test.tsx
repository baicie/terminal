// Issue #59 — the width hook's threshold did not match the width it measured.
//
// ## The mismatch
//
// `useContainerWidth` reads `entry.contentRect.width`, which is the **content box**:
// it excludes the element's own padding. The documented 520px budget was written as
// an *outer* width — it counted the pane's 24px of horizontal padding as room for
// files. So a container at 519px of content was compared against a number that had
// 24px of padding baked into it, and the two-pane layout appeared roughly 24px later
// than the comment claimed.
//
// That is conservative rather than wrong (the dock stays single a little longer),
// but a threshold nobody can reconcile with the number in the comment is a bug
// waiting to be "fixed" in the wrong direction by the next reader.
//
// ## What these tests pin
//
// 1. The threshold is stated against the same box the code measures.
// 2. A container that changes width repeatedly produces the layout each width
//    implies — the old test only ever reported one width, so a hook that ignored
//    every update after the first would still have passed.
// 3. Unmount stops the updates: a late callback must not set state on a gone
//    component.
// 4. The no-`ResizeObserver` fallback also reacts to width changes.

import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const observers: StubResizeObserver[] = []

/**
 * A `ResizeObserver` the test drives by hand.
 *
 * The previous stub reported a width once, at `observe()`, which meant nothing
 * exercised the update path. This one records every instance so a test can emit
 * new sizes in sequence, exactly as a window drag would.
 */
class StubResizeObserver implements ResizeObserver {
  static instances: StubResizeObserver[] = []
  private readonly callback: ResizeObserverCallback
  readonly observed: Element[] = []
  disconnected = false

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    StubResizeObserver.instances.push(this)
    observers.push(this)
  }

  observe(element: Element) {
    this.observed.push(element)
  }

  unobserve() {}

  disconnect() {
    this.disconnected = true
  }

  /** Report a content-box width, the way the real observer does. */
  emit(width: number) {
    this.callback(
      [
        {
          contentRect: { width },
          target: this.observed[0],
        } as unknown as ResizeObserverEntry,
      ],
      this,
    )
  }
}

const { pansNeedSingleColumn, TWO_PANE_MIN_WIDTH } = await import('./use-container-width')
const { SftpFilePanes } = await import('./sftp-file-panes')

function stubRemote() {
  return {
    files: [],
    path: '/srv',
    history: ['/srv'],
    historyIndex: 0,
    loading: false,
    selectedFile: null,
    sessionId: 's1',
    loadDir: vi.fn(),
    navigate: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    selectFile: vi.fn(),
    deleteFile: vi.fn(),
    renameFile: vi.fn(),
    mkdir: vi.fn(),
  }
}

function stubLocal() {
  return {
    files: [],
    path: '/home',
    history: ['/home'],
    historyIndex: 0,
    loading: false,
    selectedFile: null,
    pickFolder: vi.fn(),
    loadDir: vi.fn(),
    navigate: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    selectFile: vi.fn(),
  }
}

function renderPanes() {
  return render(
    <SftpFilePanes
      activeHost={{ id: 'h1', name: 'Box', hostname: 'box.example', port: 22 } as never}
      isMobile={false}
      mobilePane="remote"
      onMobilePaneChange={vi.fn()}
      local={stubLocal() as never}
      remote={stubRemote() as never}
      onMkdir={vi.fn()}
      onUpload={vi.fn()}
      onDownload={vi.fn()}
      onDelete={vi.fn()}
      onRename={vi.fn()}
    />,
  )
}

const presentation = () =>
  screen.getByTestId('sftp-file-panes').getAttribute('data-presentation')

beforeEach(() => {
  StubResizeObserver.instances = []
  observers.length = 0
  vi.stubGlobal('ResizeObserver', StubResizeObserver)
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the threshold is stated against the box the code measures', () => {
  it('documents a content-box threshold', () => {
    // `contentRect.width` excludes padding, so the constant must be expressed that
    // way too. The old comment described an outer width and the two disagreed by the
    // pane's 24px of horizontal padding.
    expect(TWO_PANE_MIN_WIDTH).toBe(496)
  })

  it('switches at that width and not one pixel earlier', () => {
    expect(pansNeedSingleColumn(TWO_PANE_MIN_WIDTH - 1)).toBe(true)
    expect(pansNeedSingleColumn(TWO_PANE_MIN_WIDTH)).toBe(false)
  })

  it('keeps treating an unmeasured container as narrow', () => {
    // Anti-flash: rendering two panes and then collapsing is visible; one pane for
    // a frame is not.
    expect(pansNeedSingleColumn(null)).toBe(true)
  })
})

describe('the layout follows every width the observer reports', () => {
  it('walks 276 → 496 → 495 → 676 → 0 → 276', () => {
    // Content-box widths, the unit the observer reports. 276 is the 300px dock minus
    // its padding; 676 is a full-width view.
    renderPanes()
    const observer = StubResizeObserver.instances[0]
    expect(observer).toBeDefined()

    act(() => observer.emit(276))
    expect(presentation()).toBe('single')

    act(() => observer.emit(496))
    expect(presentation()).toBe('split')

    act(() => observer.emit(495))
    expect(presentation()).toBe('single')

    act(() => observer.emit(676))
    expect(presentation()).toBe('split')

    // Zero means the container is hidden. The hook ignores it on purpose: treating
    // it as "narrow" would collapse and re-expand the layout on every tab switch.
    act(() => observer.emit(0))
    expect(presentation()).toBe('split')

    act(() => observer.emit(276))
    expect(presentation()).toBe('single')
  })

  it('a hook that only honoured the first measurement would fail this', () => {
    // Named for the defect it prevents: the old test emitted one width at
    // `observe()` time, so an implementation that set state once and ignored later
    // callbacks passed.
    renderPanes()
    const observer = StubResizeObserver.instances[0]
    act(() => observer.emit(300))
    act(() => observer.emit(900))
    expect(presentation()).toBe('split')
    act(() => observer.emit(300))
    expect(presentation()).toBe('single')
  })

  it('stops listening after unmount', () => {
    const { unmount } = renderPanes()
    const observer = StubResizeObserver.instances[0]
    act(() => observer.emit(300))
    unmount()

    expect(observer.disconnected).toBe(true)
    // A callback that arrives after disconnect (some polyfills deliver one) must not
    // update state on a gone component.
    expect(() => act(() => observer.emit(900))).not.toThrow()
  })
})

describe('the fallback path also reacts to changes', () => {
  it('uses window resize when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    renderPanes()

    const element = screen.getByTestId('sftp-file-panes')
    // jsdom has no layout, so the test controls what the element reports.
    let reported = 300
    element.getBoundingClientRect = () =>
      ({ width: reported, height: 600, top: 0, left: 0, right: reported, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(presentation()).toBe('single')

    reported = 900
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(presentation()).toBe('split')
  })
})
