import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalInstance } from './use-terminal-instance'

const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  fit: vi.fn(),
  proposeDimensions: vi.fn(),
  resize: vi.fn(),
  focus: vi.fn(),
  refresh: vi.fn(),
  scrollToBottom: vi.fn(),
  scrollToLine: vi.fn(),
  write: vi.fn((_data: string | Uint8Array, callback?: () => void) =>
    callback?.(),
  ),
  dispose: vi.fn(),
  webglConstruct: vi.fn(),
  webglDispose: vi.fn(),
  webglContextLossHandlers: [] as Array<() => void>,
  titleChangeHandlers: [] as Array<(title: string) => void>,
  oscHandlers: new Map<number, (data: string) => boolean>(),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = mocks.fit
    proposeDimensions = mocks.proposeDimensions
  },
}))
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    constructor() {
      mocks.webglConstruct()
    }
    onContextLoss(handler: () => void) {
      mocks.webglContextLossHandlers.push(handler)
    }
    dispose = mocks.webglDispose
  },
}))
vi.mock('@xterm/addon-clipboard', () => ({ ClipboardAddon: class {} }))
vi.mock('@baicie/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options: Record<string, unknown>
    unicode = { activeVersion: '' }
    buffer = { active: { viewportY: 0, baseY: 0 } }
    constructor(options: Record<string, unknown>) {
      mocks.construct(options)
      this.options = options
    }
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    parser = {
      registerOscHandler: (
        identifier: number,
        handler: (data: string) => boolean,
      ) => {
        mocks.oscHandlers.set(identifier, handler)
        return { dispose: () => mocks.oscHandlers.delete(identifier) }
      },
    }
    onTitleChange(handler: (title: string) => void) {
      mocks.titleChangeHandlers.push(handler)
      return { dispose: vi.fn() }
    }
    open() {}
    resize(cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
      mocks.resize(cols, rows)
    }
    focus = mocks.focus
    refresh = mocks.refresh
    scrollToBottom = mocks.scrollToBottom
    scrollToLine = mocks.scrollToLine
    write = mocks.write
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
  cursorStyle: 'block' as const,
  fontSize: 14,
  fontFamily: 'monospace',
  theme: {},
  scrollback: 1000,
  allowProposedApi: true,
  active: false,
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
    mocks.proposeDimensions.mockReturnValue({ cols: 132, rows: 43 })
    mocks.webglContextLossHandlers.length = 0
    mocks.titleChangeHandlers.length = 0
    mocks.oscHandlers.clear()
    mocks.scrollToBottom.mockImplementation(() => {})
    mocks.scrollToLine.mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
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
    expect(mocks.refresh).toHaveBeenCalledWith(0, 42)

    rerender({ tabId: 'terminal-one', active: true })
    expect(mocks.fit).toHaveBeenCalledOnce()
    expect(mocks.focus).toHaveBeenCalledOnce()
  })

  it('applies measured dimensions before exposing the terminal instance', () => {
    const { result, rerender } = renderHook(
      ({ tabId }) => useTerminalInstance({ ...baseOptions, tabId }),
      { initialProps: { tabId: '' } },
    )

    result.current.containerRef.current = document.createElement('div')
    rerender({ tabId: 'terminal-one' })

    expect(mocks.proposeDimensions).toHaveBeenCalledOnce()
    expect(mocks.resize).toHaveBeenCalledWith(132, 43)
    expect(result.current.termInstance).toMatchObject({ cols: 132, rows: 43 })
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

  it('constructs xterm with every persisted terminal setting', () => {
    const { result, rerender } = renderHook(
      ({ tabId }) =>
        useTerminalInstance({
          ...baseOptions,
          tabId,
          cursorBlink: false,
          cursorStyle: 'bar',
          fontSize: 17,
          fontFamily: 'Iosevka',
          scrollback: 4321,
          allowProposedApi: false,
        }),
      { initialProps: { tabId: '' } },
    )

    result.current.containerRef.current = document.createElement('div')
    rerender({ tabId: 'terminal-one' })

    expect(mocks.construct).toHaveBeenCalledWith(
      expect.objectContaining({
        cursorBlink: false,
        cursorStyle: 'bar',
        fontSize: 17,
        fontFamily: 'Iosevka',
        scrollback: 4321,
        allowProposedApi: false,
      }),
    )
  })

  it('forwards OSC title changes without recreating the terminal', () => {
    const onTitleChange = vi.fn()
    const { result, rerender } = renderHook(
      ({ tabId }) =>
        useTerminalInstance({ ...baseOptions, tabId, onTitleChange }),
      { initialProps: { tabId: '' } },
    )

    result.current.containerRef.current = document.createElement('div')
    rerender({ tabId: 'terminal-one' })
    mocks.titleChangeHandlers[0]?.('deploy@prod: /srv/app')

    expect(onTitleChange).toHaveBeenCalledWith('deploy@prod: /srv/app')
    expect(mocks.construct).toHaveBeenCalledOnce()
  })

  it('forwards shell integration events without intercepting terminal input', () => {
    const onShellIntegration = vi.fn()
    const { result, rerender, unmount } = renderHook(
      ({ tabId }) =>
        useTerminalInstance({ ...baseOptions, tabId, onShellIntegration }),
      { initialProps: { tabId: '' } },
    )

    result.current.containerRef.current = document.createElement('div')
    rerender({ tabId: 'terminal-one' })

    expect(mocks.oscHandlers.get(133)?.('D;7')).toBe(true)
    expect(mocks.oscHandlers.get(7)?.('file:///srv/app')).toBe(true)
    expect(onShellIntegration).toHaveBeenNthCalledWith(1, {
      kind: 'command-finished',
      exitCode: 7,
    })
    expect(onShellIntegration).toHaveBeenNthCalledWith(2, {
      kind: 'cwd',
      cwd: '/srv/app',
    })

    unmount()
    expect(mocks.oscHandlers.size).toBe(0)
  })

  it('applies persisted terminal setting changes without recreating xterm', () => {
    const { result, rerender } = renderHook(
      ({ tabId, settings }) =>
        useTerminalInstance({ ...baseOptions, tabId, ...settings }),
      {
        initialProps: {
          tabId: '',
          settings: {
            cursorBlink: true,
            cursorStyle: 'block' as 'block' | 'underline' | 'bar',
            fontFamily: 'monospace',
            scrollback: 1000,
            allowProposedApi: true,
          },
        },
      },
    )
    result.current.containerRef.current = document.createElement('div')
    rerender({
      tabId: 'terminal-one',
      settings: {
        cursorBlink: true,
        cursorStyle: 'block',
        fontFamily: 'monospace',
        scrollback: 1000,
        allowProposedApi: true,
      },
    })

    rerender({
      tabId: 'terminal-one',
      settings: {
        cursorBlink: false,
        cursorStyle: 'underline',
        fontFamily: 'Iosevka',
        scrollback: 9000,
        allowProposedApi: false,
      },
    })

    expect(result.current.termInstance?.options).toMatchObject({
      cursorBlink: false,
      cursorStyle: 'underline',
      fontFamily: 'Iosevka',
      scrollback: 9000,
      allowProposedApi: false,
    })
    expect(mocks.construct).toHaveBeenCalledOnce()
  })

  it('schedules a fit when persisted font metrics change', () => {
    const { result, rerender } = renderHook(
      ({ tabId, fontFamily, fontSize }) =>
        useTerminalInstance({
          ...baseOptions,
          tabId,
          fontFamily,
          fontSize,
        }),
      {
        initialProps: { tabId: '', fontFamily: 'monospace', fontSize: 14 },
      },
    )
    result.current.containerRef.current = document.createElement('div')
    rerender({ tabId: 'terminal-one', fontFamily: 'monospace', fontSize: 14 })
    mocks.fit.mockClear()

    rerender({ tabId: 'terminal-one', fontFamily: 'Iosevka', fontSize: 16 })

    expect(mocks.fit).toHaveBeenCalled()
    expect(result.current.termInstance?.options.fontSize).toBe(16)
    expect(result.current.fontSize).toBe(16)
  })

  it('only holds a WebGL renderer while the terminal is active', () => {
    const { result, rerender, unmount } = renderHook(
      ({ tabId, active }) =>
        useTerminalInstance({
          ...baseOptions,
          tabId,
          active,
        }),
      { initialProps: { tabId: '', active: false } },
    )
    result.current.containerRef.current = document.createElement('div')
    rerender({ tabId: 'terminal-one', active: false })

    expect(mocks.webglConstruct).not.toHaveBeenCalled()

    rerender({ tabId: 'terminal-one', active: true })
    expect(mocks.webglConstruct).toHaveBeenCalledOnce()

    rerender({ tabId: 'terminal-one', active: false })
    expect(mocks.webglDispose).toHaveBeenCalledOnce()

    rerender({ tabId: 'terminal-one', active: true })
    expect(mocks.webglConstruct).toHaveBeenCalledTimes(2)

    unmount()
    expect(mocks.webglDispose).toHaveBeenCalledTimes(2)
  })

  it('falls back after WebGL context loss and retries on reactivation', () => {
    const { result, rerender } = renderHook(
      ({ tabId, active }) =>
        useTerminalInstance({
          ...baseOptions,
          tabId,
          active,
        }),
      { initialProps: { tabId: '', active: true } },
    )
    result.current.containerRef.current = document.createElement('div')
    rerender({ tabId: 'terminal-one', active: true })

    act(() => mocks.webglContextLossHandlers.at(-1)?.())
    expect(mocks.webglDispose).toHaveBeenCalledOnce()

    act(() => window.dispatchEvent(new Event('focus')))
    expect(mocks.webglConstruct).toHaveBeenCalledTimes(2)

    rerender({ tabId: 'terminal-one', active: false })
    rerender({ tabId: 'terminal-one', active: true })
    expect(mocks.webglConstruct).toHaveBeenCalledTimes(3)
  })

  it('exposes a writer that restores a user-scrolled viewport after parsing', () => {
    const { result, rerender } = renderHook(
      ({ tabId }) => useTerminalInstance({ ...baseOptions, tabId }),
      { initialProps: { tabId: '' } },
    )
    const container = document.createElement('div')
    result.current.containerRef.current = container
    rerender({ tabId: 'terminal-one' })
    const term = result.current.termInstance!
    Object.assign(term.buffer.active, { viewportY: 40, baseY: 100 })
    container.dispatchEvent(new WheelEvent('wheel', { deltaY: -10 }))

    const outputWriter = result.current.outputWriter
    if (!outputWriter) throw new Error('terminal output writer was not created')
    outputWriter.write('new output')

    expect(mocks.write).toHaveBeenCalledWith('new output', expect.any(Function))
    expect(mocks.scrollToLine).toHaveBeenCalledWith(40)
  })

  it('keeps the terminal usable when WebGL construction is unavailable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.webglConstruct.mockImplementationOnce(() => {
      throw new Error('WebGL unavailable')
    })

    const { result, rerender } = renderHook(
      ({ tabId }) =>
        useTerminalInstance({
          ...baseOptions,
          tabId,
          active: true,
        }),
      { initialProps: { tabId: '' } },
    )
    result.current.containerRef.current = document.createElement('div')

    expect(() => rerender({ tabId: 'terminal-one' })).not.toThrow()
    expect(result.current.termInstance).not.toBeNull()
    expect(warn).toHaveBeenCalledWith(
      '[xterm] WebGL addon unavailable, using default renderer:',
      expect.any(Error),
    )
  })

  it('leaves parser errors visible through the existing console.error', () => {
    const previousConsoleError = console.error
    const visibleConsoleError = vi.fn()
    console.error = visibleConsoleError

    try {
      const { result, rerender, unmount } = renderHook(
        ({ tabId }) => useTerminalInstance({ ...baseOptions, tabId }),
        { initialProps: { tabId: '' } },
      )
      result.current.containerRef.current = document.createElement('div')
      rerender({ tabId: 'terminal-one' })

      expect(console.error).toBe(visibleConsoleError)
      console.error('xterm.js: Parsing error: invalid sequence')
      expect(visibleConsoleError).toHaveBeenCalledWith(
        'xterm.js: Parsing error: invalid sequence',
      )

      unmount()
      expect(console.error).toBe(visibleConsoleError)
    } finally {
      console.error = previousConsoleError
    }
  })
})
