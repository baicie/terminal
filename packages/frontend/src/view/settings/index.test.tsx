import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en'
import SettingsView from './index'

const mocks = vi.hoisted(() => ({
  getAppSettings: vi.fn(),
  saveAppSettings: vi.fn(async () => undefined),
}))

vi.mock('@/service/database', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    getAppSettings: mocks.getAppSettings,
    saveAppSettings: mocks.saveAppSettings,
  }
})

vi.mock('@/store/app', () => ({
  useAppStore: () => ({ setTheme: vi.fn(), setLanguage: vi.fn() }),
}))

const SETTINGS = {
  theme: 'light',
  language: 'en',
  fontSize: 14,
  fontFamily: 'Menlo',
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
} as never

beforeEach(() => {
  vi.clearAllMocks()
})

describe('settings view failure state', () => {
  it('shows the load error and recovers on retry instead of spinning forever', async () => {
    mocks.getAppSettings
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(SETTINGS)

    render(<SettingsView />)

    expect(await screen.findByText(en['settings.loadFailed'])).toBeTruthy()
    expect(screen.getByText('database unavailable')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en['common.retry'] }))

    expect(await screen.findByText(en['settings.description'])).toBeTruthy()
    expect(mocks.getAppSettings).toHaveBeenCalledTimes(2)
  })
})
