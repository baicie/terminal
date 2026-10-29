import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const scheduleOutput = vi.fn()
let overflow: ((error: Error) => void) | null = null

type Listener = {
  onOutput: (
    data: string,
    bytes?: number,
    receipt?: { isActive: () => boolean; acknowledge: () => void },
  ) => void
  onState: (snapshot: Record<string, unknown>) => void
}

let listener: Listener | null = null

vi.mock('@/features/terminal/services/terminal-session-manager', () => ({
  terminalSessionManager: {
    attach: (
      _request: unknown,
      next: Listener,
    ): {
      getIoDiagnostics: () => null
      write: () => void
      writeRaw: () => void
      resize: () => void
      disconnect: () => void
      reconnect: () => void
      dispose: () => void
    } => {
      listener = next
      return {
        getIoDiagnostics: () => null,
        write: () => {},
        writeRaw: () => {},
        resize: () => {},
        disconnect: () => {},
        reconnect: () => {},
        dispose: () => {},
      }
    },
  },
}))

vi.mock('@/features/terminal/services/terminal-output-scheduler', () => ({
  TerminalOutputScheduler: class {
    private state: 'active' | 'failed' = 'active'
    constructor(_writer: unknown, options: { onOverflow: (e: Error) => void }) {
      this.onOverflow = options.onOverflow
      // The real scheduler enters its failed state before reporting, and only
      // reset() leaves it.
      overflow = error => {
        this.state = 'failed'
        options.onOverflow(error)
      }
    }
    private onOverflow: (error: Error) => void
    enqueue(...args: unknown[]) {
      // Mirror the real scheduler: a failed scheduler silently drops output
      // until reset() puts it back into the active state.
      if (this.state !== 'active') return
      scheduleOutput(...args)
    }
    reset() {
      this.state = 'active'
    }
    dispose() {}
    snapshot() {
      return { state: this.state }
    }
    tripFailure(error: Error) {
      this.state = 'failed'
      this.onOverflow(error)
    }
  },
}))

vi.mock('@/service/terminal-write-bus', () => ({
  terminalWriteBus: { onWrite: () => () => {} },
}))

vi.mock('./terminal-input-registration', () => ({
  registerTerminalInput: () => [],
}))

import { useTerminal } from './use-terminal'

function renderUseTerminal() {
  // The real app owns one xterm for the pane's lifetime. A fresh object on
  // every render would re-run the effect and reset the hook, hiding the very
  // state leak this file is about.
  const term = { cols: 80, rows: 24 } as never
  return renderHook(() =>
    useTerminal(term, {
      tabId: 'tab-1',
      workspaceId: 'ws-1',
      tabType: 'remote',
    }),
  )
}

describe('useTerminal error reporting', () => {
  beforeEach(() => {
    scheduleOutput.mockClear()
    listener = null
    overflow = null
  })

  it('shows the current session error, not one from a previous output overflow', () => {
    const view = renderUseTerminal()

    // A one-off output overflow trips the scheduler into its failed state and
    // disconnects the binding. The hook remembers the text so it can keep
    // reporting it across snapshots.
    act(() => {
      overflow?.(new Error('terminal output queue exceeded'))
    })
    expect(view.result.current.error).toBe('terminal output queue exceeded')

    // The user reconnects and the session fails for an unrelated reason. That
    // diagnosis is the one worth acting on, but the remembered overflow text
    // wins in `outputErrorRef.current ?? snapshot.error` and hides it forever.
    act(() => {
      listener?.onState({
        status: 'error',
        sessionId: null,
        error: 'network unavailable',
      })
    })
    expect(view.result.current.error).toBe('network unavailable')

    // And once the session recovers, the stale overflow text must not keep
    // overwriting the healthy state either.
    act(() => {
      listener?.onState({
        status: 'connected',
        sessionId: 'session-2',
        error: null,
      })
    })
    expect(view.result.current.error).toBeNull()
  })

  it('resumes accepting output after the session reconnects on its own', () => {
    // An overflow fails the scheduler, which stops accepting output. Only the
    // manual reconnect button called reset(). An automatic reconnect — the one
    // the user never asked for and cannot click — brought the SSH session back
    // while the scheduler stayed failed, so every byte the new session sent was
    // silently dropped and the pane looked frozen on a healthy connection.
    renderUseTerminal()

    act(() => {
      overflow?.(new Error('terminal output queue exceeded'))
    })

    const deliveredBefore = scheduleOutput.mock.calls.length
    act(() => {
      listener?.onState({ status: 'connected', sessionId: 'session-2', error: null })
      listener?.onOutput('after reconnect', undefined, undefined)
    })

    expect(scheduleOutput.mock.calls.length).toBe(deliveredBefore + 1)
  })

  it('does not reset a healthy scheduler when a session connects', () => {
    // reset() clears the pending queue. Doing it on every connect would throw
    // away output the backend already handed over, so it must stay scoped to a
    // scheduler that actually failed.
    renderUseTerminal()

    act(() => {
      listener?.onState({ status: 'connected', sessionId: 'session-1', error: null })
      listener?.onOutput('queued frame', undefined, undefined)
    })
    const before = scheduleOutput.mock.calls.length

    act(() => {
      listener?.onState({ status: 'connected', sessionId: 'session-1', error: null })
    })

    expect(scheduleOutput.mock.calls.length).toBe(before)
  })
})
