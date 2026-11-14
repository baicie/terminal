// TN-SFTP-02 — the single/two-pane decision.
//
// The dock is 300px wide inside a 1440px viewport. `useBreakpointMax('md')` — the
// phone-layout switch — answers "desktop" for a container that cannot hold two file
// panes, so the dock rendered two ~130px panes with truncated names and buttons that
// did not fit.
//
// The fix measures the container. These tests pin the rule and the reason.

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The measurement is browser behaviour, so it is stubbed at the browser boundary —
 * `ResizeObserver` — and `useContainerWidth` itself runs for real. Mocking the hook
 * would have made the assertions below measure the mock, which is the same trap the
 * repository's other layout tests were written to avoid.
 */
const measured = vi.hoisted(() => ({ width: null as number | null }))

class StubResizeObserver {
  private readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }
  observe(element: Element) {
    const width = measured.width
    if (width === null) {
      // Before the first real measurement the hook reports null, which is what
      // "not measured yet" means. Emitting 0 here would be a different statement.
      return
    }
    this.callback(
      [{ contentRect: { width }, target: element } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
  unobserve() {}
  disconnect() {}
}

const { pansNeedSingleColumn, TWO_PANE_MIN_WIDTH } = await import(
  './use-container-width'
)
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

function renderPanes(overrides: Partial<Parameters<typeof SftpFilePanes>[0]> = {}) {
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
      {...overrides}
    />,
  )
}

/**
 * `useBreakpointMax` reads `window.matchMedia`, which jsdom does not implement.
 * Stubbing it to "never matches" makes the media-query path answer "not mobile",
 * which is what these cases want: the container measurement, not the viewport, is
 * what is under test.
 */
beforeEach(() => {
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

describe('pansNeedSingleColumn', () => {
  it('treats an unmeasured container as single', () => {
    // Not measured is not the same as measured-wide. Rendering two panes for one
    // frame and then collapsing is a visible flash.
    expect(pansNeedSingleColumn(null)).toBe(true)
  })

  it('is single at the dock width', () => {
    expect(pansNeedSingleColumn(300)).toBe(true)
  })

  it('is single just below the threshold', () => {
    expect(pansNeedSingleColumn(TWO_PANE_MIN_WIDTH - 1)).toBe(true)
  })

  it('is split at the threshold', () => {
    expect(pansNeedSingleColumn(TWO_PANE_MIN_WIDTH)).toBe(false)
  })

  it('is split for a full-page view', () => {
    expect(pansNeedSingleColumn(1280)).toBe(false)
  })
})

describe('SftpFilePanes presentation', () => {
  beforeEach(() => {
    measured.width = null
  })

  it('renders one pane with a switch in a 300px container', () => {
    measured.width = 300
    renderPanes()
    expect(
      screen.getByTestId('sftp-file-panes').getAttribute('data-presentation'),
    ).toBe('single')
    expect(screen.getByTestId('pane-switch')).toBeTruthy()
  })

  it('renders both panes side by side in a wide container', () => {
    measured.width = 1280
    renderPanes()
    expect(
      screen.getByTestId('sftp-file-panes').getAttribute('data-presentation'),
    ).toBe('split')
    expect(screen.queryByTestId('pane-switch')).toBeNull()
  })

  it('keeps the hidden pane mounted rather than unmounting it', () => {
    // A dock that toggles to local and back must not re-list the server. Both panes
    // exist in the DOM; the hidden one is `hidden`, so its state, scroll position
    // and in-flight requests survive.
    measured.width = 300
    renderPanes({ mobilePane: 'remote' })
    const local = screen.getByTestId('sftp-pane-local')
    expect(local.className).toContain('hidden')
    expect(screen.getByTestId('sftp-pane-remote').className).not.toContain('hidden')
  })

  it('shows the local pane when the switch says so', () => {
    measured.width = 300
    renderPanes({ mobilePane: 'local' })
    expect(screen.getByTestId('sftp-pane-local').className).not.toContain('hidden')
    expect(screen.getByTestId('sftp-pane-remote').className).toContain('hidden')
  })

  it('mobile forces single even in a wide container', () => {
    // A phone in landscape is wide in CSS pixels; the phone layout still has its
    // own navigation and cannot show two panes.
    measured.width = 1280
    renderPanes({ isMobile: true })
    expect(
      screen.getByTestId('sftp-file-panes').getAttribute('data-presentation'),
    ).toBe('single')
  })

  it('shows the remote directory when single', () => {
    measured.width = 300
    renderPanes()
    expect(screen.getByText('SFTP: box.example')).toBeTruthy()
  })
})
