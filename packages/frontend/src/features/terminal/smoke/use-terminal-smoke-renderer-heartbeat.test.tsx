import { act, cleanup, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

import { useTerminalSmokeRendererHeartbeat } from './use-terminal-smoke-renderer-heartbeat'

const heartbeatConfig = {
  endpoint: 'http://127.0.0.1:4321/heartbeat',
  token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
}

function setBrowserState({
  visibilityState = 'visible',
  hasFocus = true,
  online = true,
}: {
  visibilityState?: 'visible' | 'hidden'
  hasFocus?: boolean
  online?: boolean
} = {}) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visibilityState,
  })
  vi.spyOn(document, 'hasFocus').mockReturnValue(hasFocus)
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: online,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.invoke.mockReset().mockResolvedValue(heartbeatConfig)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
  Object.defineProperty(globalThis, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {},
  })
  setBrowserState()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__
  vi.useRealTimers()
})

describe('useTerminalSmokeRendererHeartbeat', () => {
  it('loads the heartbeat endpoint once when StrictMode replays effects', async () => {
    renderHook(() => useTerminalSmokeRendererHeartbeat(true), {
      wrapper: StrictMode,
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('loads the endpoint once and posts the required payload every second', async () => {
    renderHook(() => useTerminalSmokeRendererHeartbeat(true))

    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith(
      'terminal_smoke_renderer_heartbeat_config',
    )

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [initialUrl, initialOptions] = fetchMock.mock.calls[0]
    expect(new URL(String(initialUrl)).searchParams.get('token')).toBe(
      heartbeatConfig.token,
    )
    expect(initialOptions).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      signal: expect.any(AbortSignal),
    })
    expect(JSON.parse(String(initialOptions?.body))).toEqual({
      seq: 1,
      performanceNow: expect.any(Number),
      visibilityState: 'visible',
      hasFocus: true,
      online: true,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).seq).toBe(2)
  })

  it('sends immediately for visibility and focus changes with current browser state', async () => {
    renderHook(() => useTerminalSmokeRendererHeartbeat(true))
    await act(async () => {
      await Promise.resolve()
    })
    const fetchMock = vi.mocked(fetch)

    setBrowserState({
      visibilityState: 'hidden',
      hasFocus: false,
      online: false,
    })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
      window.dispatchEvent(new Event('blur'))
      await Promise.resolve()
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledTimes(4)
    const payloads = fetchMock.mock.calls.map(([, options]) =>
      JSON.parse(String(options?.body)),
    )
    expect(payloads.slice(-3)).toEqual([
      expect.objectContaining({
        seq: 2,
        visibilityState: 'hidden',
        hasFocus: false,
        online: false,
      }),
      expect.objectContaining({
        seq: 3,
        visibilityState: 'hidden',
        hasFocus: false,
        online: false,
      }),
      expect.objectContaining({
        seq: 4,
        visibilityState: 'hidden',
        hasFocus: false,
        online: false,
      }),
    ])
  })

  it('does nothing when disabled and stops timers and listeners on cleanup', async () => {
    const { unmount } = renderHook(() =>
      useTerminalSmokeRendererHeartbeat(false),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()

    const hook = renderHook(() => useTerminalSmokeRendererHeartbeat(true))
    await act(async () => {
      await Promise.resolve()
    })
    const fetchMock = vi.mocked(fetch)
    const countBeforeUnmount = fetchMock.mock.calls.length
    hook.unmount()
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(countBeforeUnmount)
    unmount()
  })

  it('silently ignores failed fetches and failed configuration loading', async () => {
    vi.mocked(fetch).mockRejectedValue(
      new Error('heartbeat endpoint unavailable'),
    )
    renderHook(() => useTerminalSmokeRendererHeartbeat(true))
    await expect(
      act(async () => {
        await Promise.resolve()
        await vi.advanceTimersByTimeAsync(1_000)
      }),
    ).resolves.toBeUndefined()

    mocks.invoke.mockRejectedValueOnce(new Error('invoke unavailable'))
    renderHook(() => useTerminalSmokeRendererHeartbeat(true))
    await expect(
      act(async () => {
        await Promise.resolve()
      }),
    ).resolves.toBeUndefined()
  })

  it('retries configuration after a rejected request when re-enabled', async () => {
    mocks.invoke
      .mockReset()
      .mockRejectedValueOnce(new Error('invoke unavailable'))
      .mockResolvedValueOnce(heartbeatConfig)
    const hook = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useTerminalSmokeRendererHeartbeat(enabled),
      { initialProps: { enabled: true } },
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    hook.rerender({ enabled: false })
    hook.rerender({ enabled: true })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.invoke).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('invalidates a pending configuration request when disabled before retrying', async () => {
    let resolveFirst: (value: typeof heartbeatConfig) => void = () => {}
    const firstRequest = new Promise<typeof heartbeatConfig>(resolve => {
      resolveFirst = resolve
    })
    mocks.invoke
      .mockReset()
      .mockImplementationOnce(() => firstRequest)
      .mockResolvedValueOnce(heartbeatConfig)
    const hook = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useTerminalSmokeRendererHeartbeat(enabled),
      { initialProps: { enabled: true } },
    )

    await act(async () => {
      await Promise.resolve()
    })
    hook.rerender({ enabled: false })
    hook.rerender({ enabled: true })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.invoke).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(1)
    resolveFirst(heartbeatConfig)
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('skips overlapping heartbeats and aborts an in-flight request on cleanup', async () => {
    let resolveFetch: (value: Response) => void = () => {}
    const pendingFetch = new Promise<Response>(resolve => {
      resolveFetch = resolve
    })
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockReset().mockReturnValueOnce(pendingFetch)
    const hook = renderHook(() => useTerminalSmokeRendererHeartbeat(true))
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const signal = fetchMock.mock.calls[0][1]?.signal as AbortSignal
    expect(signal.aborted).toBe(false)

    hook.unmount()
    expect(signal.aborted).toBe(true)
    resolveFetch({ ok: true, status: 200 } as Response)
  })

  it('accepts only successful heartbeat responses and continues after HTTP errors', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockReset()
      .mockResolvedValue({ ok: false, status: 503 } as Response)
    renderHook(() => useTerminalSmokeRendererHeartbeat(true))
    await act(async () => {
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
