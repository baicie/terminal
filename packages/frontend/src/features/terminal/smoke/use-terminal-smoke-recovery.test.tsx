import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TerminalSmokeHostWakeEvent } from './terminal-smoke-contract'
import { terminalSmokeTestConfig } from './terminal-smoke-test-fixtures'
import { useTerminalSmokeHostWakeFallback } from './use-terminal-smoke-host-wake-fallback'

const mocks = vi.hoisted(() => ({ handleHostWake: vi.fn() }))

vi.mock('@/features/terminal/services/terminal-session-manager', () => ({
  terminalSessionManager: { handleHostWake: mocks.handleHostWake },
}))

import { useTerminalSmokeRecovery } from './use-terminal-smoke-recovery'

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

function options(hostWakeRequired: boolean) {
  return {
    completeOnce: vi.fn(),
    config: { ...terminalSmokeTestConfig, hostWakeRequired },
    controller: new AbortController(),
    error: null as string | null,
    hostWakeSentRef: { current: false },
    hostWakeInFlightRef: { current: null },
    reportHostWake: vi.fn(async () => {}),
    reconnectCheckpointSentRef: { current: true },
    reconnectObservedRef: { current: false },
    reconnectStartedAtRef: { current: null as number | null },
    requiresReconnect: true,
    retryable: true as boolean | undefined,
    runControllerRef: { current: new AbortController() },
    sessionId: null,
    startedRef: { current: true },
    status: 'reconnecting' as string,
    term: {} as never,
  }
}

it('requests one host wake checkpoint after a prolonged smoke reconnect attempt', async () => {
  const recovery = options(true)
  const { rerender } = renderHook(props => useTerminalSmokeRecovery(props), {
    initialProps: recovery,
  })

  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOST_WAKE_CHECKPOINT_DELAY_MS - 1)
  })
  expect(mocks.handleHostWake).not.toHaveBeenCalled()
  expect(recovery.reportHostWake).toHaveBeenCalledWith(
    'reconnect-state-timer-armed',
    'reconnect-state-recovery',
  )

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(mocks.handleHostWake).toHaveBeenCalledTimes(1)
  expect(recovery.reportHostWake).toHaveBeenCalledTimes(3)
  expect(console.info).toHaveBeenCalledWith(
    expect.stringContaining('timer-armed source=reconnect-state-recovery'),
  )
  expect(console.info).toHaveBeenCalledWith(
    expect.stringContaining('timer-fired source=reconnect-state-recovery'),
  )
  expect(console.info).toHaveBeenCalledWith(
    expect.stringContaining(
      'reporter-resolved source=reconnect-state-recovery',
    ),
  )

  rerender({
    ...recovery,
    error: 'attempt exhausted',
    status: 'error',
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOST_WAKE_CHECKPOINT_DELAY_MS)
  })
  expect(mocks.handleHostWake).toHaveBeenCalledTimes(1)
  expect(recovery.reportHostWake).toHaveBeenCalledTimes(3)
})

it('does not synthesize host wake for ordinary reconnect smoke', async () => {
  const recovery = options(false)
  renderHook(props => useTerminalSmokeRecovery(props), {
    initialProps: recovery,
  })

  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOST_WAKE_CHECKPOINT_DELAY_MS * 2)
  })
  expect(mocks.handleHostWake).not.toHaveBeenCalled()
  expect(recovery.reportHostWake).not.toHaveBeenCalled()
})

it('keeps the reconnect round alive while disconnected arrives before reconnecting', () => {
  const recovery = options(true)
  recovery.status = 'disconnected'
  const { rerender } = renderHook(props => useTerminalSmokeRecovery(props), {
    initialProps: recovery,
  })

  expect(recovery.controller.signal.aborted).toBe(false)
  expect(recovery.completeOnce).not.toHaveBeenCalled()

  rerender({ ...recovery, status: 'reconnecting' })

  expect(recovery.controller.signal.aborted).toBe(false)
  expect(recovery.completeOnce).not.toHaveBeenCalled()
})

it('records when reconnect state changes clear the host wake timer', async () => {
  const recovery = options(true)
  const { rerender } = renderHook(props => useTerminalSmokeRecovery(props), {
    initialProps: recovery,
  })

  await act(async () => {
    await Promise.resolve()
  })
  rerender({ ...recovery, status: 'connecting' })
  await act(async () => {
    await Promise.resolve()
  })

  expect(recovery.reportHostWake).toHaveBeenCalledWith(
    'reconnect-state-timer-cleared',
    'reconnect-state-recovery',
  )
})

it('does not publish round abort diagnostics after the controller aborts', async () => {
  const recovery = options(true)
  renderHook(props => useTerminalSmokeRecovery(props), {
    initialProps: recovery,
  })

  act(() => recovery.controller.abort(new Error('round deadline')))
  await act(async () => {
    await Promise.resolve()
  })

  expect(recovery.reportHostWake).not.toHaveBeenCalled()
})

it('does not start timer cleanup IPC after the round controller aborts', async () => {
  const recovery = options(true)
  const { rerender } = renderHook(props => useTerminalSmokeRecovery(props), {
    initialProps: recovery,
  })

  act(() => recovery.controller.abort(new Error('round deadline')))
  rerender({ ...recovery, status: 'connecting' })
  await act(async () => {
    await Promise.resolve()
  })

  expect(recovery.reportHostWake).not.toHaveBeenCalledWith(
    'reconnect-state-timer-cleared',
    'reconnect-state-recovery',
  )
})

it('logs a failed reconnect timer cleanup report', async () => {
  const recovery = options(true)
  recovery.reportHostWake = vi.fn(
    async (event?: TerminalSmokeHostWakeEvent) => {
      if (event === 'reconnect-state-timer-cleared') {
        throw new Error('timer cleanup write failed')
      }
    },
  )
  const { rerender } = renderHook(props => useTerminalSmokeRecovery(props), {
    initialProps: recovery,
  })

  rerender({ ...recovery, status: 'connecting' })
  await act(async () => {
    await Promise.resolve()
  })

  expect(console.info).toHaveBeenCalledWith(
    expect.stringContaining(
      'report-failed source=reconnect-state-recovery event=reconnect-state-timer-cleared',
    ),
  )
  expect(console.info).toHaveBeenCalledWith(
    expect.stringContaining('error="timer cleanup write failed"'),
  )
})

it('keeps fallback recovery armed after a reconnect status clears its state timer', async () => {
  const recovery = options(true)
  const { result, rerender } = renderHook(
    ({ status }) => {
      const onReconnectCheckpoint = useTerminalSmokeHostWakeFallback({
        completeOnce: recovery.completeOnce,
        config: recovery.config,
        controller: recovery.controller,
        hostWakeSentRef: recovery.hostWakeSentRef,
        hostWakeInFlightRef: recovery.hostWakeInFlightRef,
        reportHostWake: recovery.reportHostWake,
        runControllerRef: recovery.runControllerRef,
        runningSessionIdRef: { current: recovery.sessionId },
        term: recovery.term,
      })
      useTerminalSmokeRecovery({ ...recovery, status })
      return onReconnectCheckpoint
    },
    { initialProps: { status: 'reconnecting' } },
  )

  act(() => result.current())
  await act(async () => {
    await Promise.resolve()
  })
  rerender({ status: 'connecting' })
  await act(async () => {
    await Promise.resolve()
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOST_WAKE_CHECKPOINT_DELAY_MS)
  })

  expect(recovery.reportHostWake).toHaveBeenCalledWith(
    'reconnect-state-timer-cleared',
    'reconnect-state-recovery',
  )
  expect(recovery.reportHostWake).toHaveBeenCalledWith(
    'fallback-timer-fired',
    'reconnect-checkpoint-fallback',
  )
  expect(mocks.handleHostWake).toHaveBeenCalledTimes(1)
})

it('reports a structured smoke failure when host wake publishing rejects', async () => {
  const recovery = options(true)
  const checkpointError = new Error('checkpoint write failed')
  recovery.reportHostWake = vi.fn(async () => {
    throw checkpointError
  })
  recovery.term = { cols: 80, rows: 24 } as never
  renderHook(props => useTerminalSmokeRecovery(props), {
    initialProps: recovery,
  })

  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOST_WAKE_CHECKPOINT_DELAY_MS)
  })

  expect(recovery.completeOnce).toHaveBeenCalledTimes(1)
  expect(recovery.completeOnce).toHaveBeenCalledWith(
    null,
    expect.objectContaining({
      ok: false,
      error: expect.stringContaining('checkpoint write failed'),
    }),
  )
})

it('publishes host wake when the error snapshot arrives before retryable metadata', async () => {
  const recovery = options(true)
  recovery.retryable = undefined
  recovery.status = 'error'
  recovery.term = { cols: 80, rows: 24 } as never
  renderHook(props => useTerminalSmokeRecovery(props), {
    initialProps: recovery,
  })

  await act(async () => {
    await Promise.resolve()
  })

  expect(recovery.reportHostWake).toHaveBeenCalledTimes(1)
  expect(mocks.handleHostWake).toHaveBeenCalledTimes(1)
})

it('does not publish host wake for a non-retryable reconnect error', () => {
  const recovery = options(true)
  recovery.retryable = false
  recovery.status = 'error'
  recovery.term = { cols: 80, rows: 24 } as never
  renderHook(props => useTerminalSmokeRecovery(props), {
    initialProps: recovery,
  })

  expect(recovery.reportHostWake).not.toHaveBeenCalled()
  expect(recovery.controller.signal.aborted).toBe(true)
  expect(mocks.handleHostWake).not.toHaveBeenCalled()
})
