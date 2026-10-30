import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./connection', () => ({
  executeQuery: vi.fn(),
  select: vi.fn(),
}))

import { executeQuery, select } from './connection'
import { defaultSettings, getAppSettings, saveAppSettings } from './settings'

const writeCalls = () => vi.mocked(executeQuery).mock.calls

function storedValue(fields: Record<string, unknown>) {
  return [{ value: JSON.stringify(fields) }] as never
}

function lastWrittenSettings(): Record<string, unknown> {
  const calls = writeCalls()
  expect(calls).toHaveLength(1)
  const [sql, params = []] = calls[0]
  expect(sql).toContain('INSERT OR REPLACE INTO settings')
  expect(params[0]).toBe('app_settings')
  return JSON.parse(params[1] as string) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(executeQuery).mockResolvedValue({ rowsAffected: 1 } as never)
})

describe('terminalThemeLight default and one-time migration', () => {
  it('defaults a fresh install to the pure-white github-light theme', async () => {
    vi.mocked(select).mockResolvedValue([] as never)

    const settings = await getAppSettings()

    expect(defaultSettings.terminalThemeLight).toBe('github-light')
    expect(defaultSettings.terminalThemeLightMigrated).toBe(false)
    expect(settings.terminalThemeLight).toBe('github-light')
    expect(settings.terminalThemeDark).toBe('one-dark')
    expect(settings.terminalThemeLightMigrated).toBe(true)
    expect(writeCalls()).toHaveLength(0)
  })

  it('persists the settled flag so a fresh install keeping solarized-light sticks', async () => {
    vi.mocked(select).mockResolvedValueOnce([] as never)

    await saveAppSettings({ terminalThemeLight: 'solarized-light' })

    const written = lastWrittenSettings()
    expect(written.terminalThemeLight).toBe('solarized-light')
    expect(written.terminalThemeLightMigrated).toBe(true)

    vi.mocked(select).mockResolvedValueOnce(storedValue(written))
    vi.mocked(executeQuery).mockClear()

    const settings = await getAppSettings()

    expect(settings.terminalThemeLight).toBe('solarized-light')
    expect(writeCalls()).toHaveLength(0)
  })

  it('migrates the legacy solarized-light default once and persists the flag', async () => {
    vi.mocked(select).mockResolvedValue(
      storedValue({ theme: 'light', terminalThemeLight: 'solarized-light' }),
    )

    const settings = await getAppSettings()

    expect(settings.terminalThemeLight).toBe('github-light')
    expect(settings.theme).toBe('light')
    const written = lastWrittenSettings()
    expect(written.terminalThemeLight).toBe('github-light')
    expect(written.terminalThemeDark).toBe('one-dark')
    expect(written.terminalThemeLightMigrated).toBe(true)
  })

  it('keeps a user who deliberately picks solarized-light after migrating', async () => {
    vi.mocked(select).mockResolvedValue(
      storedValue({
        terminalThemeLight: 'solarized-light',
        terminalThemeLightMigrated: true,
      }),
    )

    const settings = await getAppSettings()

    expect(settings.terminalThemeLight).toBe('solarized-light')
    expect(writeCalls()).toHaveLength(0)
  })

  it('stamps the flag on old installs that never used the legacy default', async () => {
    vi.mocked(select).mockResolvedValue(
      storedValue({ terminalThemeLight: 'one-light' }),
    )

    const settings = await getAppSettings()

    expect(settings.terminalThemeLight).toBe('one-light')
    const written = lastWrittenSettings()
    expect(written.terminalThemeLight).toBe('one-light')
    expect(written.terminalThemeLightMigrated).toBe(true)
  })
})
