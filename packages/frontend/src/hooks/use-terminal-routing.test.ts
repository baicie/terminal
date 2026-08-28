import { act, renderHook } from '@testing-library/react'
import type { Terminal as XTerminal } from '@baicie/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TERMINAL_RECONNECT_MODE_RESET, useTerminal } from './use-terminal'
import type { TerminalOutputReceipt } from '@/features/terminal/services/terminal-session-manager-types'

type WriteListener = (data: string, targetTabId?: string) => void

function outputReceipt(acknowledge = vi.fn()): TerminalOutputReceipt {
  return { isActive: () => true, acknowledge }
}

const mocks = vi.hoisted(() => ({
  attach: vi.fn(),
  bindings: new Map<
    string,
    {
      write: ReturnType<typeof vi.fn>
      writeRaw: ReturnType<typeof vi.fn>
    }
  >(),
  sessionListeners: new Map<
    string,
    {
      onOutput: (
        data: string,
        bytes: number | undefined,
        receipt: TerminalOutputReceipt,
      ) => void
      onState: (state: object) => void
    }
  >(),
  listeners: new Set<WriteListener>(),
  registerTerminalInput: vi.fn(() => []),
}))

vi.mock('@/features/terminal/services/terminal-session-manager', () => ({
  terminalSessionManager: { attach: mocks.attach },
}))

vi.mock('@/service/terminal-write-bus', () => ({
  terminalWriteBus: {
    onWrite(listener: WriteListener) {
      mocks.listeners.add(listener)
      return () => mocks.listeners.delete(listener)
    },
  },
}))

vi.mock('./terminal-input-registration', () => ({
  registerTerminalInput: mocks.registerTerminalInput,
}))

describe('useTerminal emitter routing', () => {
  beforeEach(() => {
    mocks.bindings.clear()
    mocks.sessionListeners.clear()
    mocks.listeners.clear()
    mocks.attach.mockReset()
    mocks.attach.mockImplementation(
      (
        request: { tabId: string },
        listener: {
          onOutput: (
            data: string,
            bytes: number | undefined,
            receipt: TerminalOutputReceipt,
          ) => void
          onState: (state: object) => void
        },
      ) => {
        const binding = {
          write: vi.fn(),
          writeRaw: vi.fn(),
          resize: vi.fn(),
          reconnect: vi.fn(),
          disconnect: vi.fn(),
          dispose: vi.fn(),
        }
        mocks.bindings.set(request.tabId, binding)
        mocks.sessionListeners.set(request.tabId, listener)
        listener.onState({
          sessionId: `session-${request.tabId}`,
          status: 'connected',
          error: null,
        })
        return binding
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes only to the terminal whose tab id exactly matches the target', () => {
    const terminal = {} as XTerminal
    const first = renderHook(() =>
      useTerminal(terminal, {
        tabId: 'tab-one',
        workspaceId: 'workspace-one',
        tabType: 'local',
      }),
    )
    const second = renderHook(() =>
      useTerminal(terminal, {
        tabId: 'tab-two',
        workspaceId: 'workspace-one',
        tabType: 'local',
      }),
    )

    act(() => {
      mocks.listeners.forEach(listener => listener('untargeted'))
    })
    expect(mocks.bindings.get('tab-one')?.write).not.toHaveBeenCalled()
    expect(mocks.bindings.get('tab-two')?.write).not.toHaveBeenCalled()

    act(() => {
      mocks.listeners.forEach(listener => listener('targeted', 'tab-two'))
    })
    expect(mocks.bindings.get('tab-one')?.write).not.toHaveBeenCalled()
    expect(mocks.bindings.get('tab-two')?.write).toHaveBeenCalledOnce()
    expect(mocks.bindings.get('tab-two')?.write).toHaveBeenCalledWith(
      'targeted',
    )

    first.unmount()
    second.unmount()
  })

  it('attaches with the xterm dimensions measured after open', () => {
    const terminal = {
      cols: 80,
      rows: 24,
      open() {
        this.cols = 132
        this.rows = 43
      },
    }
    terminal.open()

    const instance = renderHook(() =>
      useTerminal(terminal as unknown as XTerminal, {
        tabId: 'tab-sized-after-open',
        workspaceId: 'workspace-one',
        tabType: 'local',
      }),
    )

    expect(mocks.attach).toHaveBeenCalledWith(
      expect.objectContaining({ cols: 132, rows: 43 }),
      expect.any(Object),
    )

    instance.unmount()
  })

  it('does not attach before a connection gate enables the session', () => {
    const terminal = { cols: 100, rows: 30 } as unknown as XTerminal
    const { rerender, unmount } = renderHook(
      ({ enabled, expectedHostKey }) =>
        useTerminal(terminal, {
          tabId: 'tab-gated',
          workspaceId: 'workspace-one',
          tabType: 'remote',
          enabled,
          expectedHostKey,
        }),
      {
        initialProps: {
          enabled: false,
          expectedHostKey: undefined as string | undefined,
        },
      },
    )

    expect(mocks.attach).not.toHaveBeenCalled()

    rerender({ enabled: true, expectedHostKey: 'ssh-ed25519 AAAApinned' })

    expect(mocks.attach).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedHostKey: 'ssh-ed25519 AAAApinned',
      }),
      expect.any(Object),
    )
    unmount()
  })

  it('exposes reconnect progress instead of collapsing it into connecting', () => {
    const terminal = { cols: 100, rows: 30 } as unknown as XTerminal
    const instance = renderHook(() =>
      useTerminal(terminal, {
        tabId: 'tab-reconnecting',
        workspaceId: 'workspace-one',
        tabType: 'remote',
      }),
    )

    act(() => {
      mocks.sessionListeners.get('tab-reconnecting')?.onState({
        sessionId: null,
        status: 'reconnecting',
        error: null,
        attempt: 2,
        reason: 'connection reset',
        nextRetryAt: 12_345,
        retryable: true,
      })
    })

    expect(instance.result.current).toMatchObject({
      status: 'reconnecting',
      attempt: 2,
      reason: 'connection reset',
      nextRetryAt: 12_345,
      retryable: true,
    })
    instance.unmount()
  })

  it('leaves alternate-screen and input modes without clearing scrollback', () => {
    let frame: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frame = callback
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const write = vi.fn()
    const terminal = { cols: 100, rows: 30, write } as unknown as XTerminal
    const instance = renderHook(() =>
      useTerminal(terminal, {
        tabId: 'tab-mode-reset',
        workspaceId: 'workspace-one',
        tabType: 'remote',
      }),
    )

    act(() => {
      mocks.sessionListeners.get('tab-mode-reset')?.onState({
        sessionId: null,
        status: 'reconnecting',
        error: null,
        attempt: 1,
        reason: 'connection reset',
      })
      frame?.(16)
    })

    expect(write).toHaveBeenCalledWith(
      TERMINAL_RECONNECT_MODE_RESET,
      expect.any(Function),
    )
    expect(TERMINAL_RECONNECT_MODE_RESET).toContain('\x1b[?1049l')
    expect(TERMINAL_RECONNECT_MODE_RESET).not.toContain('\x1bc')
    instance.unmount()
  })

  it('resets terminal modes once per reconnect cycle, not once per attempt', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const write = vi.fn((_data: string, callback?: () => void) => callback?.())
    const terminal = { cols: 100, rows: 30, write } as unknown as XTerminal
    const instance = renderHook(() =>
      useTerminal(terminal, {
        tabId: 'tab-reconnect-cycles',
        workspaceId: 'workspace-one',
        tabType: 'remote',
      }),
    )
    const onState = mocks.sessionListeners.get('tab-reconnect-cycles')?.onState
    const flushFrames = () => {
      frames.splice(0).forEach(frame => frame(16))
    }

    act(() => {
      onState?.({
        sessionId: null,
        status: 'reconnecting',
        error: null,
        attempt: 1,
      })
      onState?.({
        sessionId: null,
        status: 'reconnecting',
        error: null,
        attempt: 2,
      })
      flushFrames()
    })

    expect(write.mock.calls.map(call => call[0])).toEqual([
      TERMINAL_RECONNECT_MODE_RESET,
    ])

    act(() => {
      onState?.({
        sessionId: 'session-tab-reconnect-cycles-next',
        status: 'connected',
        error: null,
      })
      onState?.({
        sessionId: null,
        status: 'reconnecting',
        error: null,
        attempt: 1,
      })
      onState?.({
        sessionId: null,
        status: 'reconnecting',
        error: null,
        attempt: 2,
      })
      flushFrames()
    })

    expect(write.mock.calls.map(call => call[0])).toEqual([
      TERMINAL_RECONNECT_MODE_RESET,
      TERMINAL_RECONNECT_MODE_RESET,
    ])
    instance.unmount()
  })

  it('batches backend output before writing it to xterm', () => {
    let frame: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frame = callback
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const write = vi.fn()
    const terminal = { cols: 100, rows: 30, write } as unknown as XTerminal
    const instance = renderHook(() =>
      useTerminal(terminal, {
        tabId: 'tab-output',
        workspaceId: 'workspace-one',
        tabType: 'local',
      }),
    )

    act(() => {
      mocks.sessionListeners
        .get('tab-output')
        ?.onOutput('hello ', undefined, outputReceipt())
      mocks.sessionListeners
        .get('tab-output')
        ?.onOutput('world', undefined, outputReceipt())
    })
    expect(write).not.toHaveBeenCalled()

    act(() => frame?.(16))
    expect(write).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledWith('hello world', expect.any(Function))

    instance.unmount()
  })

  it('writes scheduled output through the supplied viewport writer', () => {
    let frame: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frame = callback
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const terminalWrite = vi.fn()
    const viewportWrite = vi.fn()
    const terminal = {
      cols: 100,
      rows: 30,
      write: terminalWrite,
    } as unknown as XTerminal
    const instance = renderHook(() =>
      useTerminal(terminal, {
        tabId: 'tab-viewport-output',
        workspaceId: 'workspace-one',
        tabType: 'local',
        outputWriter: { write: viewportWrite },
      }),
    )

    act(() => {
      mocks.sessionListeners
        .get('tab-viewport-output')
        ?.onOutput('preserve viewport', undefined, outputReceipt())
      frame?.(16)
    })

    expect(viewportWrite).toHaveBeenCalledWith(
      'preserve viewport',
      expect.any(Function),
    )
    expect(terminalWrite).not.toHaveBeenCalled()
    instance.unmount()
  })

  it('acknowledges rendered output through the owning session binding', () => {
    let frame: FrameRequestCallback | null = null
    let completeWrite: (() => void) | undefined
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frame = callback
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const write = vi.fn((_data: string, callback?: () => void) => {
      completeWrite = callback
    })
    const terminal = { cols: 100, rows: 30, write } as unknown as XTerminal
    const acknowledge = vi.fn()
    const instance = renderHook(() =>
      useTerminal(terminal, {
        tabId: 'tab-output-ack',
        workspaceId: 'workspace-one',
        tabType: 'local',
      }),
    )

    act(() => {
      mocks.sessionListeners
        .get('tab-output-ack')
        ?.onOutput('中🙂', 7, outputReceipt(acknowledge))
      frame?.(16)
    })
    expect(acknowledge).not.toHaveBeenCalled()

    act(() => completeWrite?.())
    expect(acknowledge).toHaveBeenCalledOnce()

    instance.unmount()
  })
})
