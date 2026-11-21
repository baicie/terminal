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
  clipboardConstruct: vi.fn(),
  webglContextLossHandlers: [] as Array<() => void>,
  titleChangeHandlers: [] as Array<(title: string) => void>,
  oscHandlers: new Map<number, (data: string) => boolean>(),
  open: vi.fn(),
  traceStage: vi.fn(),
}))

vi.mock('@/service/database/startup-trace', () => ({
  traceStage: mocks.traceStage,
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
vi.mock('@xterm/addon-clipboard', () => ({
  ClipboardAddon: class {
    constructor() {
      mocks.clipboardConstruct()
    }
  },
}))
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
    open(container?: HTMLElement) {
      mocks.open(container)
    }
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
  terminalType: 'local' as const,
  tabAvailable: true,
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

  it('records the terminal mount against both tab and workspace', () => {
    const { result, rerender } = renderHook(
      ({ tabId }) => useTerminalInstance({ ...baseOptions, tabId }),
      { initialProps: { tabId: '' } },
    )

    result.current.containerRef.current = document.createElement('div')
    rerender({ tabId: 'terminal-one' })

    expect(mocks.traceStage).toHaveBeenCalledWith(
      'terminal-mounted',
      'terminal-one@workspace-one@local',
    )
  })

  it('records the owning tab type in mount evidence', () => {
    const { result, rerender } = renderHook(
      ({ tabId, terminalType }) =>
        useTerminalInstance({
          ...baseOptions,
          tabId,
          terminalType,
        }),
      { initialProps: { tabId: '', terminalType: 'remote' as const } },
    )

    result.current.containerRef.current = document.createElement('div')
    rerender({ tabId: 'remote-one', terminalType: 'remote' })
    expect(mocks.traceStage).toHaveBeenCalledWith(
      'terminal-mounted',
      'remote-one@workspace-one@remote',
    )
  })

  it('records open-start and open-done around a successful xterm open', () => {
    const { result, rerender } = renderHook(
      ({ tabId }) => useTerminalInstance({ ...baseOptions, tabId }),
      { initialProps: { tabId: '' } },
    )
    result.current.containerRef.current = document.createElement('div')
    rerender({ tabId: 'terminal-one' })

    expect(mocks.open).toHaveBeenCalledOnce()
    expect(mocks.traceStage.mock.calls.map(call => call[0])).toEqual(
      expect.arrayContaining([
        'terminal-open-start',
        'terminal-open-done',
        'terminal-mounted',
      ]),
    )
    expect(result.current.mountFailure).toBeNull()
  })

  it('records a failed xterm open instead of throwing out of the effect', () => {
    mocks.open.mockImplementationOnce(() => {
      throw new Error('open failed in WebKit')
    })
    const { result, rerender } = renderHook(
      ({ tabId }) => useTerminalInstance({ ...baseOptions, tabId }),
      { initialProps: { tabId: '' } },
    )
    result.current.containerRef.current = document.createElement('div')

    expect(() => rerender({ tabId: 'terminal-one' })).not.toThrow()
    expect(result.current.mountFailure).toBe('open failed in WebKit')
    expect(mocks.traceStage).toHaveBeenCalledWith(
      'terminal-open-failed',
      'open failed in WebKit',
    )
    expect(mocks.traceStage).not.toHaveBeenCalledWith(
      'terminal-mounted',
      expect.anything(),
    )
  })

  it('mounts a terminal restored after the empty container already rendered', () => {
    const { result, rerender } = renderHook(
      ({ tabId, tabAvailable }) =>
        useTerminalInstance({ ...baseOptions, tabId, tabAvailable }),
      { initialProps: { tabId: '', tabAvailable: false } },
    )
    result.current.containerRef.current = document.createElement('div')

    expect(mocks.traceStage).not.toHaveBeenCalled()
    rerender({ tabId: 'remote-one', tabAvailable: true })

    expect(mocks.traceStage).toHaveBeenCalledWith(
      'terminal-mounted',
      'remote-one@workspace-one@local',
    )
    expect(result.current.termInstance).not.toBeNull()
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

    expect(mocks.oscHandlers.get(133)?.('A')).toBe(true)
    expect(onShellIntegration).toHaveBeenNthCalledWith(1, {
      kind: 'prompt-start',
    })
    expect(mocks.oscHandlers.get(133)?.('D;7')).toBe(true)
    expect(mocks.oscHandlers.get(7)?.('file:///srv/app')).toBe(true)
    expect(onShellIntegration).toHaveBeenNthCalledWith(2, {
      kind: 'command-finished',
      exitCode: 7,
    })
    expect(onShellIntegration).toHaveBeenNthCalledWith(3, {
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

  it('loads the clipboard addon once while the terminal stays mounted', async () => {
    const { result, rerender } = renderHook(
      ({ tabId }) => useTerminalInstance({ ...baseOptions, tabId }),
      { initialProps: { tabId: '' } },
    )
    result.current.containerRef.current = document.createElement('div')
    rerender({ tabId: 'terminal-one' })

    expect(mocks.clipboardConstruct).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      for (let index = 0; index < 6; index += 1) await Promise.resolve()
    })

    expect(mocks.clipboardConstruct).toHaveBeenCalledOnce()
  })

  it('never loads the clipboard addon into a disposed terminal', async () => {
    const { result, rerender, unmount } = renderHook(
      ({ tabId }) => useTerminalInstance({ ...baseOptions, tabId }),
      { initialProps: { tabId: '' } },
    )
    result.current.containerRef.current = document.createElement('div')
    rerender({ tabId: 'terminal-one' })

    expect(mocks.clipboardConstruct).not.toHaveBeenCalled()
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      for (let index = 0; index < 6; index += 1) await Promise.resolve()
    })

    expect(mocks.clipboardConstruct).not.toHaveBeenCalled()
  })
})

/*
 * ## Two panes must not share one terminal
 *
 * A split shows two `useTerminalInstance` hooks at once. Everything a user notices
 * about "the two panes are separate" — scrollback, the selection, the cursor, the
 * measured cols/rows, the shell prompt itself — lives on the xterm object each hook
 * constructs. If a refactor moved that object to module scope, hoisted it into a
 * context, or memoised it on something that does not include the tab id, both panes
 * would drive one buffer and the spec's "do not cross streams" requirement would fail
 * in a way that looks like a rendering glitch.
 *
 * The mock counts constructions, so this asserts the object identity directly rather
 * than inferring it from what gets drawn.
 */
describe('two panes hold two terminals', () => {
  beforeEach(() => {
    // The outer `beforeEach` only runs for cases inside its own `describe`, so the
    // globals this hook needs are re-stubbed here.
    vi.useFakeTimers()
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    mocks.proposeDimensions.mockReturnValue({ cols: 132, rows: 43 })
    mocks.scrollToBottom.mockImplementation(() => {})
    mocks.scrollToLine.mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })
  /** Mount one hook the way the existing cases do: container, then a tab id. */
  function mountPane(tabId: string, scrollback: number, active: boolean) {
    const hook = renderHook(
      ({ current }) => useTerminalInstance(current),
      {
        initialProps: {
          current: { ...baseOptions, tabId: '', scrollback, active: false },
        },
      },
    )
    hook.result.current.containerRef.current = document.createElement('div')
    hook.rerender({ current: { ...baseOptions, tabId, scrollback, active } })
    act(() => vi.runAllTimers())
    return hook
  }
  it('constructs a separate xterm for each pane', () => {
    mocks.construct.mockClear()

    const left = mountPane('pane-left', 1000, true)
    const right = mountPane('pane-right', 1000, false)

    /*
     * Two constructions, not one shared by both. Everything a user notices about "the
     * two panes are separate" — scrollback, selection, cursor, measured cols/rows, the
     * shell prompt — lives on the xterm object each hook creates. A refactor that moved
     * it to module scope or memoised it on something not including the tab id would
     * make both panes drive one buffer.
     */
    expect(mocks.construct).toHaveBeenCalledTimes(2)
    // The hook exposes the live instance as `termInstance` and the ref that owns it.
    const terminals = [left, right].map(
      hook => hook.result.current.termInstance ?? hook.result.current.termRef.current,
    )
    expect(terminals[0]).toBeTruthy()
    expect(terminals[1]).toBeTruthy()
    expect(terminals[0]).not.toBe(terminals[1])
  })

  it('gives each pane its own scrollback setting', () => {
    /*
     * A split where both panes shared one object would also mean the second pane's
     * setting overwrote the first's — invisible until the user scrolls back in one.
     */
    mocks.construct.mockClear()
    mountPane('pane-a', 1000, true)
    mountPane('pane-b', 5000, false)

    const options = mocks.construct.mock.calls.map(
      call => call[0] as { scrollback?: number },
    )
    expect(options.map(entry => entry.scrollback)).toEqual([1000, 5000])
  })
})

/*
 * ## Fifty re-renders must not mean fifty terminals
 *
 * T06 asks for 100 open/close or resize cycles with no repeated terminal creation. The
 * expensive mistake is not a slow `fit()` — it is constructing a second `Terminal`,
 * which throws away scrollback, selection, the cursor and the shell's own state. A hook
 * that keys its effect on an object literal, on a callback identity, or on `fontSize`
 * changing by identity would do exactly that, and the symptom a user reports is "the
 * screen went blank when I resized".
 *
 * `recreates xterm when the workspace changes` already covers the case where a rebuild
 * is *correct*. What was missing is the opposite: the cases where nothing about the
 * session changed and a rebuild would be a bug.
 *
 * The mock counts constructions, so fifty re-renders with a single construction is the
 * assertion, not something inferred from the DOM.
 */
describe('re-rendering does not create a second terminal', () => {
  beforeEach(() => {
    /*
     * The outer stubs live in another `describe`, so this block needs its own.
     *
     * `clearAllMocks` first, not only in `afterEach`: the previous describe's hooks are
     * unmounted by the testing-library cleanup, which runs *after* this file's
     * `afterEach`. Their `dispose` calls would otherwise land in this block's first case
     * and read as "a re-render disposed the terminal".
     */
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    mocks.proposeDimensions.mockReturnValue({ cols: 132, rows: 43 })
    mocks.scrollToBottom.mockImplementation(() => {})
    mocks.scrollToLine.mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })
  /** Mount one pane the way the other cases do: container first, then a tab id. */
  function mount(initial: Partial<typeof baseOptions> = {}) {
    const props = { ...baseOptions, tabId: '', ...initial }
    const hook = renderHook(
      ({ p }) => useTerminalInstance(p),
      { initialProps: { p: props } },
    )
    hook.result.current.containerRef.current = document.createElement('div')
    hook.rerender({ p: { ...props, tabId: 'terminal-one' } })
    act(() => vi.runAllTimers())
    return hook
  }
  it('keeps one terminal across fifty identical re-renders', () => {
    const hook = mount()
    expect(mocks.construct).toHaveBeenCalledTimes(1)

    for (let i = 0; i < 50; i += 1) {
      // A fresh object each time, which is what a parent re-render produces.
      hook.rerender({
        p: { ...baseOptions, tabId: 'terminal-one', active: i % 2 === 0 },
      })
      act(() => vi.runAllTimers())
    }

    expect(
      mocks.construct,
      'a re-render must not construct a second terminal: that discards scrollback, ' +
        'selection and the shell state the user is looking at',
    ).toHaveBeenCalledTimes(1)
    expect(mocks.dispose).not.toHaveBeenCalled()
  })

  it('survives a font-size change without rebuilding', () => {
    /*
     * Font size is a *presentation* change. xterm can apply it through its options, and
     * rebuilding for it is the classic way to lose a user's scrollback when they pinch
     * or press Ctrl+= in the middle of reading a log.
     *
     * Whether the hook actually applies the new size is a separate question; this asserts
     * only that it does not pay for it with a new terminal.
     */
    const hook = mount()
    expect(mocks.construct).toHaveBeenCalledTimes(1)

    for (const fontSize of [12, 14, 16, 18, 20]) {
      hook.rerender({ p: { ...baseOptions, tabId: 'terminal-one', fontSize } })
      act(() => vi.runAllTimers())
    }

    expect(mocks.construct).toHaveBeenCalledTimes(1)
  })

  it('survives a theme change without rebuilding', () => {
    // Theme is applied through `term.options.theme`; constructing a new Terminal for it
    // would also drop every addon the user's session relies on.
    const hook = mount()
    expect(mocks.construct).toHaveBeenCalledTimes(1)

    const themes = [
      { background: '#000000' },
      { background: '#ffffff' },
      { background: '#1e1e2e' },
    ]
    for (const theme of themes) {
      hook.rerender({ p: { ...baseOptions, tabId: 'terminal-one', theme } })
      act(() => vi.runAllTimers())
    }

    expect(mocks.construct).toHaveBeenCalledTimes(1)
  })

  it('does rebuild when the tab itself changes', () => {
    /*
     * The control. Without it, a hook that never rebuilt anything would pass all three
     * cases above while showing the wrong session after a tab switch.
     */
    const hook = mount()
    expect(mocks.construct).toHaveBeenCalledTimes(1)

    hook.rerender({ p: { ...baseOptions, tabId: 'terminal-two' } })
    act(() => vi.runAllTimers())

    expect(mocks.construct).toHaveBeenCalledTimes(2)
  })
})