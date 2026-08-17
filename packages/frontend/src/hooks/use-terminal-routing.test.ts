import { act, renderHook } from '@testing-library/react'
import type { Terminal as XTerminal } from '@baicie/xterm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminal } from './use-terminal'

type WriteListener = (data: string, targetTabId?: string) => void

const mocks = vi.hoisted(() => ({
  attach: vi.fn(),
  bindings: new Map<string, { write: ReturnType<typeof vi.fn> }>(),
  listeners: new Set<WriteListener>(),
  registerTerminalInput: vi.fn(() => []),
}))

vi.mock('@/features/terminal/services/terminal-session-manager', () => ({
  terminalSessionManager: { attach: mocks.attach },
}))

vi.mock('@/service/terminal-emitter', () => ({
  terminalEmitter: {
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
    mocks.listeners.clear()
    mocks.attach.mockReset()
    mocks.attach.mockImplementation(
      (
        request: { tabId: string },
        listener: { onState: (state: object) => void },
      ) => {
        const binding = {
          write: vi.fn(),
          resize: vi.fn(),
          reconnect: vi.fn(),
          disconnect: vi.fn(),
          dispose: vi.fn(),
        }
        mocks.bindings.set(request.tabId, binding)
        listener.onState({
          sessionId: `session-${request.tabId}`,
          status: 'connected',
          error: null,
        })
        return binding
      },
    )
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
})
