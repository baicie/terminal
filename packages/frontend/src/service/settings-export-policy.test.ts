// `syncServiceToken` is a credential for the user's own storage backend.
//
// It sits *inside* the `app_settings` JSON value, not as its own settings-table
// key. A filter that removes the row named `syncServiceToken` therefore removes
// nothing and looks correct while doing it. These tests assert on the serialised
// file and the serialised upload body, not on the filter helper: the helper being
// right is not the same as the file being clean.

import { beforeEach, expect, it, vi } from 'vitest'
import { collectExportData, exportDataToFile } from './sync-export'
import { syncToServer } from './sync-server'
import {
  exportableAppSettings,
  exportableTeamSettings,
  importableSettings,
  mergeRestoredAppSettings,
  withheldSettingKeys,
} from './settings-export-policy'

const TOKEN = 'super-secret-storage-token-9f3a'
const TEAM_TOKEN = 'team-api-token-4b7c'

const mocks = vi.hoisted(() => ({
  selectStrict: vi.fn(),
  getUserProfile: vi.fn(),
  getKnownHosts: vi.fn(),
  getSSHKeys: vi.fn(),
  getWorkspaceLayout: vi.fn(),
  getWorkspaces: vi.fn(),
  save: vi.fn(),
  writeTextFile: vi.fn(),
  storageUpload: vi.fn(),
  storageDownload: vi.fn(),
}))

vi.mock('@/service/database', () => ({
  executeQuery: vi.fn(),
  getUserProfile: mocks.getUserProfile,
  selectStrict: mocks.selectStrict,
}))
vi.mock('@/service/database/known-hosts', () => ({
  getKnownHosts: mocks.getKnownHosts,
}))
vi.mock('@/service/database/ssh-keys', () => ({ getSSHKeys: mocks.getSSHKeys }))
vi.mock('@/service/database/workspaces', () => ({
  getWorkspaceLayout: mocks.getWorkspaceLayout,
  getWorkspaces: mocks.getWorkspaces,
}))
vi.mock('@/service/storage', () => ({
  storageDownload: mocks.storageDownload,
  storageUpload: mocks.storageUpload,
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mocks.save }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: mocks.writeTextFile }))

function settingsRows() {
  return [
    {
      key: 'app_settings',
      value: JSON.stringify({
        theme: 'dark',
        language: 'cn',
        fontSize: 16,
        syncServiceEndpoint: 'https://dav.example.test',
        syncServiceUsername: 'alice',
        syncServiceToken: TOKEN,
      }),
    },
    {
      key: 'team_settings',
      value: JSON.stringify({
        enabled: true,
        mode: 'cloud',
        endpoint: 'https://team.example.test',
        syncInterval: 30000,
        apiToken: TEAM_TOKEN,
      }),
    },
    { key: 'terminal_shortcuts', value: '{"copy":"Ctrl+C"}' },
  ]
}

function primeExport() {
  mocks.selectStrict.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM settings')) return settingsRows()
    if (sql.includes('FROM hosts')) return []
    return []
  })
  mocks.getUserProfile.mockResolvedValue({ id: 'user-1' })
  mocks.getKnownHosts.mockResolvedValue([])
  mocks.getSSHKeys.mockResolvedValue([])
  mocks.getWorkspaces.mockResolvedValue([])
  mocks.getWorkspaceLayout.mockResolvedValue(null)
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  primeExport()
})

it('the plain export file contains no storage token', async () => {
  mocks.save.mockResolvedValue('/tmp/export.json')
  mocks.writeTextFile.mockResolvedValue(undefined)

  await exportDataToFile()

  expect(mocks.writeTextFile).toHaveBeenCalledTimes(1)
  const [, contents] = mocks.writeTextFile.mock.calls[0] as [string, string]
  expect(contents).not.toContain(TOKEN)
  expect(contents).not.toContain(TEAM_TOKEN)
})

it('the plain export keeps ordinary preferences', async () => {
  const data = await collectExportData()

  const appSettings = JSON.parse(String(data.settings.app_settings)) as Record<
    string,
    unknown
  >
  expect(appSettings.theme).toBe('dark')
  expect(appSettings.language).toBe('cn')
  expect(appSettings.fontSize).toBe(16)
  // The endpoint and username are how the user finds their storage, not how they
  // authenticate to it.
  expect(appSettings.syncServiceEndpoint).toBe('https://dav.example.test')
  expect(appSettings.syncServiceUsername).toBe('alice')
  // And the token is gone.
  expect(appSettings).not.toHaveProperty('syncServiceToken')

  const teamSettings = JSON.parse(
    String(data.settings.team_settings),
  ) as Record<string, unknown>
  expect(teamSettings.enabled).toBe(true)
  expect(teamSettings.apiToken ?? undefined).toBeUndefined()
})

it('the cloud upload body contains no storage token', async () => {
  mocks.storageUpload.mockResolvedValue({ success: true, message: 'ok' })

  await syncToServer()

  expect(mocks.storageUpload).toHaveBeenCalledTimes(2)
  for (const call of mocks.storageUpload.mock.calls) {
    const body = call[1] as string
    expect(body).not.toContain(TOKEN)
    expect(body).not.toContain(TEAM_TOKEN)
    // Preferences survive: the body is pretty-printed JSON with the settings
    // object stored as a string, so the theme appears inside an escaped value.
    expect(body).toContain('theme')
    expect(body).toContain('dark')
  }
})

it('a setting added by a future build is withheld until it is reviewed', () => {
  // The allowlist fails closed: an unknown field is dropped, not passed through.
  expect(
    exportableAppSettings({ theme: 'dark', futureCredential: 'nope' }),
  ).toEqual({ theme: 'dark' })
  expect(withheldSettingKeys({ theme: 'dark', futureCredential: 'nope' })).toEqual([
    'futureCredential',
  ])
})

it('an unknown top-level settings key is withheld', () => {
  const filtered = importableSettings({
    syncServiceToken: TOKEN,
    some_future_secret: 'nope',
    terminal_shortcuts: '{"copy":"Ctrl+C"}',
  })
  expect(filtered).toEqual({ terminal_shortcuts: '{"copy":"Ctrl+C"}' })
})

it('importing a file cannot overwrite the local token', () => {
  const local = { theme: 'light', syncServiceToken: 'local-token' }
  const restored = { theme: 'dark', syncServiceToken: TOKEN }
  const merged = mergeRestoredAppSettings(local, restored)
  expect(merged.theme).toBe('dark')
  expect(merged.syncServiceToken).toBe('local-token')
})

it('importing a file cannot introduce a token the device never had', () => {
  const merged = mergeRestoredAppSettings({ theme: 'light' }, { syncServiceToken: TOKEN })
  expect(merged).not.toHaveProperty('syncServiceToken')
})

it('a file carrying app_settings has its credentials stripped and its preferences kept', () => {
  const filtered = importableSettings({
    app_settings: JSON.stringify({
      theme: 'dark',
      fontSize: 18,
      syncServiceToken: TOKEN,
    }),
  })
  const parsed = JSON.parse(String(filtered.app_settings)) as Record<string, unknown>
  expect(parsed).toEqual({ theme: 'dark', fontSize: 18 })
})

it('team settings keep the endpoint and drop the api token', () => {
  expect(
    exportableTeamSettings({ endpoint: 'https://t.example', apiToken: TEAM_TOKEN }),
  ).toEqual({ endpoint: 'https://t.example' })
})
