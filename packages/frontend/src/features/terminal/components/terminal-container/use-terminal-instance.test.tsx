import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalInstance } from './use-terminal-instance'

const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  fit: vi.fn(),
  focus: vi.fn(),
  dispose: vi.fn(),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = mocks.fit
  },
}))
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss() {}
    dispose() {}
  },
}))
vi.mock('@xterm/addon-clipboard', () => ({ ClipboardAddon: class {} }))
vi.mock('@baicie/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown>
    unicode = { activeVersion: '' }
    constructor(options: Record<string, unknown>) {
      mocks.construct()
      this.options = options
    }
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    open() {}
    focus = mocks.focus
    dispose = mocks.dispose
  },
}))

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

const baseOptions = {
  tabId: '',
  workspaceId: 'workspace-one',
  isMobile: false,
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'monospace',
  theme: {},
  scrollback: 1000,
  active: false,
  onOpenSearch: vi.fn(),
}

describe('useTerminalInstance activation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('fits and focuses once when an existing terminal becomes active', () => {
    const { result, rerender } = renderHook(
      ({ tabId, active }) =>
        useTerminalInstance({ ...baseOptions, tabId, active }),
      { initialProps: { tabId: '', active: false } },
    )

    result.current.containerRef.current = document.createElement('div')
    rerender({ tabId: 'terminal-one', active: false })
    act(() => vi.runAllTimers())
    mocks.fit.mockClear()
    mocks.focus.mockClear()

    rerender({ tabId: 'terminal-one', active: true })
    expect(mocks.fit).toHaveBeenCalledOnce()
    expect(mocks.focus).toHaveBeenCalledOnce()

    rerender({ tabId: 'terminal-one', active: true })
    expect(mocks.fit).toHaveBeenCalledOnce()
    expect(mocks.focus).toHaveBeenCalledOnce()
  })

  it('cancels the deferred initial fit when the terminal is unmounted', () => {
    const { result, rerender, unmount } = renderHook(
      ({ tabId }) => useTerminalInstance({ ...baseOptions, tabId }),
      { initialProps: { tabId: '' } },
    )

    result.current.containerRef.current = document.createElement('div')
    rerender({ tabId: 'terminal-one' })
    mocks.fit.mockClear()
    mocks.focus.mockClear()

    unmount()
    act(() => vi.runAllTimers())

    expect(mocks.fit).not.toHaveBeenCalled()
    expect(mocks.focus).not.toHaveBeenCalled()
  })

  it('recreates xterm when the workspace changes with the same tab id', () => {
    const { result, rerender } = renderHook(
      ({ tabId, workspaceId }) =>
        useTerminalInstance({ ...baseOptions, tabId, workspaceId }),
      { initialProps: { tabId: '', workspaceId: 'workspace-one' } },
    )

    result.current.containerRef.current = document.createElement('div')
    rerender({ tabId: 'shared-tab', workspaceId: 'workspace-one' })
    act(() => vi.runAllTimers())
    expect(mocks.construct).toHaveBeenCalledOnce()

    rerender({ tabId: 'shared-tab', workspaceId: 'workspace-two' })
    act(() => vi.runAllTimers())

    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(mocks.construct).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['older instance first', 0, 1],
    ['newer instance first', 1, 0],
  ])(
    'shares error suppression and restores console.error when unmounting the %s',
    (_label, firstUnmount, secondUnmount) => {
      const previousConsoleError = console.error
      const originalConsoleError = vi.fn()
      console.error = originalConsoleError

      const instances: Array<{ unmount: () => void } | undefined> = []
      try {
        for (const tabId of ['terminal-one', 'terminal-two']) {
          const instance = renderHook(
            ({ id }) => useTerminalInstance({ ...baseOptions, tabId: id }),
            { initialProps: { id: '' } },
          )
          instance.result.current.containerRef.current =
            document.createElement('div')
          instance.rerender({ id: tabId })
          instances.push(instance)
        }

        const sharedSuppression = console.error
        expect(sharedSuppression).not.toBe(originalConsoleError)

        instances[firstUnmount]?.unmount()
        instances[firstUnmount] = undefined
        expect(console.error).toBe(sharedSuppression)

        console.error('xterm.js: Parsing error: ignored sequence')
        expect(originalConsoleError).not.toHaveBeenCalled()

        const failure = new Error('renderer failed')
        console.error('unrelated terminal failure', failure)
        expect(originalConsoleError).toHaveBeenCalledWith(
          'unrelated terminal failure',
          failure,
        )

        instances[secondUnmount]?.unmount()
        instances[secondUnmount] = undefined
        expect(console.error).toBe(originalConsoleError)
      } finally {
        instances.forEach(instance => instance?.unmount())
        console.error = previousConsoleError
      }
    },
  )
})
