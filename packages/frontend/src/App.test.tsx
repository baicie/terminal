import { render, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'

const mocks = vi.hoisted(() => ({
  disposeRecovery: vi.fn(),
  hydrateFromDatabase: vi.fn(),
  initializeTeam: vi.fn(),
  startWorkspaceRecovery: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  I18nextProvider: ({ children }: { children: React.ReactNode }) => children,
  useTranslation: () => ({
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))
vi.mock('react-router-dom', () => ({ RouterProvider: () => null }))
vi.mock('./locales', () => ({ default: {} }))
vi.mock('./router', () => ({ router: {} }))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('./store/app', () => ({
  useAppStore: (
    selector: (state: {
      theme: string
      language: string
      hydrateFromDatabase: () => Promise<void>
    }) => unknown,
  ) =>
    selector({
      theme: 'dark',
      language: 'en',
      hydrateFromDatabase: mocks.hydrateFromDatabase,
    }),
}))
vi.mock('./store/team', () => ({
  useTeamStore: (selector: (state: { initialize: () => Promise<void> }) => unknown) =>
    selector({ initialize: mocks.initializeTeam }),
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

it('starts workspace recovery with the app and disposes it on unmount', async () => {
  const view = render(<App />)

  await waitFor(() => expect(mocks.startWorkspaceRecovery).toHaveBeenCalledOnce())
  view.unmount()

  expect(mocks.disposeRecovery).toHaveBeenCalledOnce()
})
