import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import App, {
  STARTUP_TERMINAL_FALLBACK_MS,
  WORKSPACE_RECOVERY_RETRY_DELAYS_MS,
} from './App'

const mocks = vi.hoisted(() => ({
  disposeRecovery: vi.fn(),
  hydrateFromDatabase: vi.fn(),
  initializeTeam: vi.fn(),
  startWorkspaceRecovery: vi.fn(),
  appState: {
    theme: 'dark',
    language: 'en',
    tabs: [] as Array<{ id: string; label: string; type: 'local' }>,
    addTab: vi.fn(),
  },
}))

vi.mock('react-i18next', () => ({
  I18nextProvider: ({ children }: { children: React.ReactNode }) => children,
  useTranslation: () => ({
    i18n: { language: 'en', changeLanguage: vi.fn() },
    t: (key: string) => key,
  }),
}))
vi.mock('react-router-dom', () => ({ RouterProvider: () => null }))
vi.mock('./locales', () => ({ default: {} }))
vi.mock('./router', () => ({ router: {} }))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('./store/app', () => {
  const useAppStore = (
    selector: (
      state: typeof mocks.appState & {
        hydrateFromDatabase: () => Promise<void>
      },
    ) => unknown,
  ) =>
    selector({
      ...mocks.appState,
      hydrateFromDatabase: mocks.hydrateFromDatabase,
    })
  useAppStore.getState = () => mocks.appState
  return { useAppStore }
})
vi.mock('./store/team', () => ({
  useTeamStore: (
    selector: (state: { initialize: () => Promise<void> }) => unknown,
  ) => selector({ initialize: mocks.initializeTeam }),
}))
vi.mock('./service/database', () => ({
  getAppSettings: vi.fn().mockResolvedValue({}),
}))
vi.mock('./service/notifications', () => ({ applyNotificationPrefs: vi.fn() }))
vi.mock('./service/window-ux', () => ({ syncCloseToTray: vi.fn() }))
vi.mock('./service/workspace-recovery', () => ({
  startWorkspaceRecovery: mocks.startWorkspaceRecovery,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.appState.tabs = []
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  mocks.hydrateFromDatabase.mockResolvedValue(undefined)
  mocks.initializeTeam.mockResolvedValue(undefined)
  mocks.startWorkspaceRecovery.mockResolvedValue({
    flush: vi.fn(),
    dispose: mocks.disposeRecovery,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

it('starts workspace recovery with the app and disposes it on unmount', async () => {
  const view = render(<App />)

  await waitFor(() =>
    expect(mocks.startWorkspaceRecovery).toHaveBeenCalledOnce(),
  )
  view.unmount()

  expect(mocks.disposeRecovery).toHaveBeenCalledOnce()
})

describe('startup terminal fallback', () => {
  it('opens a local terminal when recovery misses the startup deadline', async () => {
    vi.useFakeTimers()
    render(<App />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STARTUP_TERMINAL_FALLBACK_MS)
    })

    expect(mocks.appState.addTab).toHaveBeenCalledWith({
      label: 'Local',
      type: 'local',
      startupFallback: true,
    })
  })

  it('keeps the startup fallback when workspace recovery fails', async () => {
    vi.useFakeTimers()
    mocks.startWorkspaceRecovery.mockRejectedValue(
      new Error('database unavailable'),
    )
    render(<App />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STARTUP_TERMINAL_FALLBACK_MS)
    })

    expect(mocks.appState.addTab).toHaveBeenCalledWith({
      label: 'Local',
      type: 'local',
      startupFallback: true,
    })
  })

  it('retries transient workspace recovery failures with a bounded delay', async () => {
    vi.useFakeTimers()
    const recovered = { flush: vi.fn(), dispose: mocks.disposeRecovery }
    mocks.startWorkspaceRecovery
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(recovered)

    const view = render(<App />)
    await act(async () => {
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(WORKSPACE_RECOVERY_RETRY_DELAYS_MS[0])
    })

    expect(mocks.startWorkspaceRecovery).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(mocks.disposeRecovery).toHaveBeenCalledOnce()
  })

  it('stops after the bounded recovery retries are exhausted', async () => {
    vi.useFakeTimers()
    mocks.startWorkspaceRecovery.mockRejectedValue(
      new Error('database unavailable'),
    )

    render(<App />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.startWorkspaceRecovery).toHaveBeenCalledOnce()

    for (const delay of WORKSPACE_RECOVERY_RETRY_DELAYS_MS) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay)
        await Promise.resolve()
      })
    }

    expect(mocks.startWorkspaceRecovery).toHaveBeenCalledTimes(
      WORKSPACE_RECOVERY_RETRY_DELAYS_MS.length + 1,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
      await Promise.resolve()
    })
    expect(mocks.startWorkspaceRecovery).toHaveBeenCalledTimes(
      WORKSPACE_RECOVERY_RETRY_DELAYS_MS.length + 1,
    )
  })

  it('does not open a fallback when recovery restored a tab', async () => {
    vi.useFakeTimers()
    render(<App />)
    mocks.appState.tabs = [{ id: 'saved', label: 'Saved', type: 'local' }]

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STARTUP_TERMINAL_FALLBACK_MS)
    })

    expect(mocks.appState.addTab).not.toHaveBeenCalled()
  })

  it('cancels the fallback when a slow recovery restores a tab', async () => {
    vi.useFakeTimers()
    let resolveRecovery: (value: {
      dispose: () => void
      flush: () => Promise<void>
    }) => void = () => undefined
    mocks.startWorkspaceRecovery.mockReturnValue(
      new Promise(resolve => {
        resolveRecovery = resolve
      }),
    )
    render(<App />)
    mocks.appState.tabs = [{ id: 'saved', label: 'Saved', type: 'local' }]

    await act(async () => {
      resolveRecovery({ dispose: vi.fn(), flush: vi.fn() })
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STARTUP_TERMINAL_FALLBACK_MS)
    })

    expect(mocks.appState.addTab).not.toHaveBeenCalled()
  })

  it('aborts a pending recovery when the app unmounts', async () => {
    vi.useFakeTimers()
    let resolveRecovery: (value: {
      dispose: () => void
      flush: () => Promise<void>
    }) => void = () => undefined
    mocks.startWorkspaceRecovery.mockReturnValue(
      new Promise(resolve => {
        resolveRecovery = resolve
      }),
    )

    const view = render(<App />)
    const [[{ signal }]] = mocks.startWorkspaceRecovery.mock.calls
    view.unmount()

    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(true)

    const dispose = vi.fn()
    await act(async () => {
      resolveRecovery({ dispose, flush: vi.fn() })
      await Promise.resolve()
    })
    expect(dispose).toHaveBeenCalledOnce()
  })
})
