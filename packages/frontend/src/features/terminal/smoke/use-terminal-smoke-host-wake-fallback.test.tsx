import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { terminalSmokeTestConfig } from './terminal-smoke-test-fixtures'

const mocks = vi.hoisted(() => ({ handleHostWake: vi.fn() }))

vi.mock('@/features/terminal/services/terminal-session-manager', () => ({
  terminalSessionManager: { handleHostWake: mocks.handleHostWake },
}))

import {
  reportTerminalSmokeHostWakeStage,
  requestTerminalSmokeHostWakeCheckpoint,
  useTerminalSmokeHostWakeFallback,
} from './use-terminal-smoke-host-wake-fallback'
import type { TerminalSmokeHostWakeEvent } from './terminal-smoke-contract'

const HOST_WAKE_CHECKPOINT_DELAY_MS = 15_000

beforeEach(() => {
  vi.useFakeTimers()
  mocks.handleHostWake.mockReset()
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function options() {
  return {
    completeOnce: vi.fn(),
    config: { ...terminalSmokeTestConfig, hostWakeRequired: true },
    controller: new AbortController(),
    hostWakeSentRef: { current: false },
    hostWakeInFlightRef: { current: null as Promise<void> | null },
    reportHostWake: vi.fn(async (_event?: TerminalSmokeHostWakeEvent) => {}),
    runControllerRef: { current: new AbortController() },
    runningSessionIdRef: { current: 'ssh-session-old' },
    term: { cols: 80, rows: 24 } as never,
  }
}

it('publishes host wake after the reconnect checkpoint and only once', async () => {
  const fallback = options()
  const { result } = renderHook(() =>
    useTerminalSmokeHostWakeFallback(fallback),
  )

  act(() => result.current())
  await act(async () => {
    await Promise.resolve()
  })
  expect(fallback.reportHostWake).toHaveBeenCalledTimes(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOST_WAKE_CHECKPOINT_DELAY_MS - 1)
  })
  expect(mocks.handleHostWake).not.toHaveBeenCalled()
  expect(fallback.reportHostWake).toHaveBeenCalledTimes(4)
  expect(fallback.reportHostWake).toHaveBeenCalledWith(
    'fallback-poll',
    'reconnect-checkpoint-fallback',
  )

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  act(() => result.current())
  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOST_WAKE_CHECKPOINT_DELAY_MS)
  })

  expect(mocks.handleHostWake).toHaveBeenCalledTimes(1)
  expect(fallback.reportHostWake).toHaveBeenCalledTimes(6)
  expect(console.info).toHaveBeenCalledWith(
    expect.stringContaining('timer-armed source=reconnect-checkpoint-fallback'),
  )
  expect(console.info).toHaveBeenCalledWith(
    expect.stringContaining('timer-fired source=reconnect-checkpoint-fallback'),
  )
  expect(console.info).toHaveBeenCalledWith(
    expect.stringContaining(
      'reporter-resolved source=reconnect-checkpoint-fallback',
    ),
  )
})

it('keeps reporting fallback polls and marks a pending host wake request', async () => {
  const fallback = options()
  fallback.hostWakeInFlightRef.current = new Promise<void>(() => {})
  const { result } = renderHook(() =>
    useTerminalSmokeHostWakeFallback(fallback),
  )

  act(() => result.current())
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000)
  })

  expect(fallback.reportHostWake).toHaveBeenCalledWith(
    'fallback-poll-in-flight',
    'reconnect-checkpoint-fallback',
  )
  expect(fallback.reportHostWake).toHaveBeenCalledWith(
    'fallback-poll',
    'reconnect-checkpoint-fallback',
  )
})

it('logs a failed fallback poll report', async () => {
  const fallback = options()
  fallback.reportHostWake = vi.fn(
    async (event?: TerminalSmokeHostWakeEvent) => {
      if (event === 'fallback-poll') throw new Error('poll write failed')
    },
  )
  const { result } = renderHook(() =>
    useTerminalSmokeHostWakeFallback(fallback),
  )

  act(() => result.current())
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250)
  })

  expect(console.info).toHaveBeenCalledWith(
    expect.stringContaining(
      'poll-report-failed source=reconnect-checkpoint-fallback',
    ),
  )
})

it.each([
  ['host wake sent before the interval tick', 'host-wake-sent', 1],
  ['controller abort before the interval tick', 'controller-aborted', 0],
])(
  'handles fallback timer clear when %s',
  async (_label, reason, expectedCount) => {
    const fallback = options()
    const { result, unmount } = renderHook(() =>
      useTerminalSmokeHostWakeFallback(fallback),
    )

    act(() => result.current())
    if (reason === 'host-wake-sent') fallback.hostWakeSentRef.current = true
    else fallback.controller.abort(new Error('round aborted'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(
      fallback.reportHostWake.mock.calls.filter(
        ([event]) => event === 'fallback-timer-cleared',
      ),
    ).toHaveLength(expectedCount)
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(
      fallback.reportHostWake.mock.calls.filter(
        ([event]) => event === 'fallback-timer-cleared',
      ),
    ).toHaveLength(expectedCount)
  },
)

it.each(['host-wake-first', 'abort-first'] as const)(
  'reports one fallback timer clear when host wake and abort cross ticks (%s)',
  async order => {
    const fallback = options()
    const { result } = renderHook(() =>
      useTerminalSmokeHostWakeFallback(fallback),
    )

    act(() => result.current())
    if (order === 'host-wake-first') {
      fallback.hostWakeSentRef.current = true
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250)
      })
      fallback.controller.abort(new Error('round aborted'))
    } else {
      fallback.controller.abort(new Error('round aborted'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250)
      })
      fallback.hostWakeSentRef.current = true
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(
      fallback.reportHostWake.mock.calls.filter(
        ([event]) => event === 'fallback-timer-cleared',
      ),
    ).toHaveLength(order === 'host-wake-first' ? 1 : 0)
  },
)

it('logs a failed fallback timer cleanup report', async () => {
  const fallback = options()
  fallback.reportHostWake = vi.fn(
    async (event?: TerminalSmokeHostWakeEvent) => {
      if (event === 'fallback-timer-cleared')
        throw new Error('cleanup write failed')
    },
  )
  const { result, unmount } = renderHook(() =>
    useTerminalSmokeHostWakeFallback(fallback),
  )

  act(() => result.current())
  unmount()
  await act(async () => {
    await Promise.resolve()
  })

  expect(console.info).toHaveBeenCalledWith(
    expect.stringContaining(
      'report-failed source=reconnect-checkpoint-fallback event=fallback-timer-cleared',
    ),
  )
  expect(console.info).toHaveBeenCalledWith(
    expect.stringContaining('error="cleanup write failed"'),
  )
})

it('fires the fallback host wake reporter only once while it is pending', async () => {
  const fallback = options()
  let resolveTimerReport: (() => void) | undefined
  fallback.reportHostWake = vi.fn((event?: TerminalSmokeHostWakeEvent) =>
    event === 'fallback-timer-fired'
      ? new Promise<void>(resolve => {
          resolveTimerReport = resolve
        })
      : Promise.resolve(),
  )
  const { result, unmount } = renderHook(() =>
    useTerminalSmokeHostWakeFallback(fallback),
  )

  act(() => result.current())
  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOST_WAKE_CHECKPOINT_DELAY_MS + 1_000)
  })

  expect(
    fallback.reportHostWake.mock.calls.filter(
      ([event]) => event === 'fallback-timer-fired',
    ),
  ).toHaveLength(1)
  unmount()
  resolveTimerReport?.()
})

it('turns a rejected host wake checkpoint into a smoke failure', async () => {
  const fallback = options()
  fallback.reportHostWake = vi.fn(async () => {
    throw new Error('checkpoint write failed')
  })
  const { result } = renderHook(() =>
    useTerminalSmokeHostWakeFallback(fallback),
  )

  act(() => result.current())
  await act(async () => {
    await Promise.resolve()
  })
  expect(fallback.reportHostWake).toHaveBeenCalledWith(
    'fallback-armed',
    'reconnect-checkpoint-fallback',
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOST_WAKE_CHECKPOINT_DELAY_MS)
    await Promise.resolve()
  })

  expect(fallback.completeOnce).toHaveBeenCalledTimes(1)
  expect(fallback.completeOnce).toHaveBeenCalledWith(
    'ssh-session-old',
    expect.objectContaining({
      ok: false,
      error: expect.stringContaining('checkpoint write failed'),
    }),
  )
})

it('publishes the host wake checkpoint before resuming terminal sessions', async () => {
  const fallback = options()
  const events: string[] = []
  fallback.reportHostWake = vi.fn(async (event = 'checkpoint') => {
    events.push(event)
  })
  mocks.handleHostWake.mockImplementation(() => {
    events.push('wake')
  })
  const { result } = renderHook(() =>
    useTerminalSmokeHostWakeFallback(fallback),
  )

  act(() => result.current())
  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOST_WAKE_CHECKPOINT_DELAY_MS)
  })

  expect(events[0]).toBe('fallback-armed')
  expect(
    events.filter(event => event === 'fallback-poll').length,
  ).toBeGreaterThan(1)
  expect(events.slice(-3)).toEqual([
    'fallback-timer-fired',
    'checkpoint',
    'wake',
  ])
})

it('clears a pending host wake timer when its round unmounts', async () => {
  const fallback = options()
  const { result, unmount } = renderHook(() =>
    useTerminalSmokeHostWakeFallback(fallback),
  )

  act(() => result.current())
  unmount()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOST_WAKE_CHECKPOINT_DELAY_MS)
  })

  expect(mocks.handleHostWake).not.toHaveBeenCalled()
  expect(fallback.reportHostWake).toHaveBeenCalledTimes(2)
  expect(fallback.reportHostWake).toHaveBeenCalledWith(
    'fallback-timer-cleared',
    'reconnect-checkpoint-fallback',
  )
})

it('does not publish fallback cleanup IPC after the round controller aborts', async () => {
  const fallback = options()
  const { result, unmount } = renderHook(() =>
    useTerminalSmokeHostWakeFallback(fallback),
  )

  act(() => result.current())
  act(() => fallback.controller.abort(new Error('round unmounted')))
  unmount()
  await act(async () => {
    await Promise.resolve()
  })

  expect(fallback.reportHostWake).not.toHaveBeenCalledWith(
    'fallback-timer-cleared',
    'reconnect-checkpoint-fallback',
  )
})

it('shares one in-flight host wake request across concurrent triggers', async () => {
  const hostWakeSentRef = { current: false }
  const hostWakeInFlightRef = { current: null as Promise<void> | null }
  let resolveCheckpoint: (() => void) | undefined
  const reportHostWake = vi.fn(
    () =>
      new Promise<void>(resolve => {
        resolveCheckpoint = resolve
      }),
  )

  const first = requestTerminalSmokeHostWakeCheckpoint(
    hostWakeSentRef,
    hostWakeInFlightRef,
    reportHostWake,
    'retryable-error',
  )
  const second = requestTerminalSmokeHostWakeCheckpoint(
    hostWakeSentRef,
    hostWakeInFlightRef,
    reportHostWake,
    'reconnect-state-recovery',
  )

  expect(first).toBe(second)
  await act(async () => {
    await Promise.resolve()
  })
  expect(reportHostWake).toHaveBeenCalledTimes(1)
  expect(hostWakeSentRef.current).toBe(false)

  resolveCheckpoint?.()
  await first
  expect(hostWakeSentRef.current).toBe(true)
  expect(mocks.handleHostWake).toHaveBeenCalledTimes(1)
  expect(hostWakeInFlightRef.current).toBeNull()
})

it('does not overlap a later retry with a timed-out reporter', async () => {
  const hostWakeSentRef = { current: false }
  const hostWakeInFlightRef = { current: null as Promise<void> | null }
  let resolveStuckReporter: (() => void) | undefined
  const reportHostWake = vi
    .fn<() => Promise<void>>()
    .mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          resolveStuckReporter = resolve
        }),
    )
    .mockResolvedValueOnce()

  const first = requestTerminalSmokeHostWakeCheckpoint(
    hostWakeSentRef,
    hostWakeInFlightRef,
    reportHostWake,
    'retryable-error',
  )
  const rejected = expect(first).rejects.toThrow('timed out after 5000 ms')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000)
  })
  await rejected
  expect(hostWakeSentRef.current).toBe(false)
  expect(hostWakeInFlightRef.current).toBeNull()

  const retry = requestTerminalSmokeHostWakeCheckpoint(
    hostWakeSentRef,
    hostWakeInFlightRef,
    reportHostWake,
    'reconnect-checkpoint-fallback',
  )
  await act(async () => {
    await Promise.resolve()
  })
  expect(reportHostWake).toHaveBeenCalledTimes(1)

  resolveStuckReporter?.()
  await retry
  expect(reportHostWake).toHaveBeenCalledTimes(2)
  expect(hostWakeSentRef.current).toBe(true)
})

it('drops a queued reporter stage when its wait times out', async () => {
  let resolveStuckReporter: (() => void) | undefined
  const reportHostWake = vi
    .fn<() => Promise<void>>()
    .mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          resolveStuckReporter = resolve
        }),
    )
    .mockResolvedValueOnce()
  const first = reportTerminalSmokeHostWakeStage(
    reportHostWake,
    'checkpoint',
    'retryable-error',
  )
  const firstRejected = expect(first).rejects.toThrow('timed out after 5000 ms')
  await act(async () => {
    await Promise.resolve()
  })
  const queued = reportTerminalSmokeHostWakeStage(
    reportHostWake,
    'fallback-poll',
    'reconnect-checkpoint-fallback',
  )
  const queuedRejected = expect(queued).rejects.toThrow(
    'timed out after 5000 ms',
  )

  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000)
  })
  await Promise.all([firstRejected, queuedRejected])
  resolveStuckReporter?.()
  await act(async () => {
    await Promise.resolve()
  })
  expect(reportHostWake).toHaveBeenCalledTimes(1)

  await reportTerminalSmokeHostWakeStage(
    reportHostWake,
    'checkpoint',
    'retryable-error',
  )
  expect(reportHostWake).toHaveBeenCalledTimes(2)
})

it('fails when a required host wake reporter is unavailable', async () => {
  const hostWakeSentRef = { current: false }
  const hostWakeInFlightRef = { current: null as Promise<void> | null }
  const request = requestTerminalSmokeHostWakeCheckpoint(
    hostWakeSentRef,
    hostWakeInFlightRef,
    undefined,
    'retryable-error',
  )

  await expect(request).rejects.toThrow('reporter is unavailable')
  expect(hostWakeSentRef.current).toBe(false)
  expect(hostWakeInFlightRef.current).toBeNull()
  expect(mocks.handleHostWake).not.toHaveBeenCalled()
})

it('does not resume sessions when the round aborts during a pending checkpoint', async () => {
  const hostWakeSentRef = { current: false }
  const hostWakeInFlightRef = { current: null as Promise<void> | null }
  const controller = new AbortController()
  let resolveCheckpoint: (() => void) | undefined
  const reportHostWake = vi.fn(
    () =>
      new Promise<void>(resolve => {
        resolveCheckpoint = resolve
      }),
  )

  const request = requestTerminalSmokeHostWakeCheckpoint(
    hostWakeSentRef,
    hostWakeInFlightRef,
    reportHostWake,
    'retryable-error',
    controller.signal,
  )
  await act(async () => {
    await Promise.resolve()
  })
  controller.abort(new Error('round unmounted'))
  resolveCheckpoint?.()

  await expect(request).rejects.toThrow('round unmounted')
  expect(hostWakeSentRef.current).toBe(false)
  expect(mocks.handleHostWake).not.toHaveBeenCalled()
})
