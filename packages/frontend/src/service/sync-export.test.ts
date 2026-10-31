import { beforeEach, expect, it, vi } from 'vitest'
import { collectExportData } from './sync-export'
import { syncToServer } from './sync-server'

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  getUserProfile: vi.fn(),
  getKnownHosts: vi.fn(),
  getSSHKeys: vi.fn(),
  getWorkspaceLayout: vi.fn(),
  getWorkspaces: vi.fn(),
  save: vi.fn(),
  selectStrict: vi.fn(),
  storageDownload: vi.fn(),
  storageUpload: vi.fn(),
  writeTextFile: vi.fn(),
}))

vi.mock('@/service/database', () => ({
  executeQuery: mocks.executeQuery,
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

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.getUserProfile.mockResolvedValue({ id: 'user-1' })
  mocks.getKnownHosts.mockResolvedValue([])
  mocks.getSSHKeys.mockResolvedValue([])
  mocks.getWorkspaces.mockResolvedValue([])
  mocks.selectStrict.mockResolvedValue([])
  mocks.storageUpload.mockResolvedValue({
    success: true,
    message: 'ok',
    timestamp: 1,
  })
})

it('aborts the export when a backup source cannot be read', async () => {
  mocks.selectStrict.mockRejectedValue(
    new Error('Database query failed: disk I/O error'),
  )

  await expect(collectExportData()).rejects.toThrow('disk I/O error')
})

it('aborts the upload when the backup source cannot be read', async () => {
  mocks.selectStrict.mockRejectedValue(
    new Error('Database query failed: disk I/O error'),
  )

  await expect(syncToServer()).rejects.toThrow('disk I/O error')
  expect(mocks.storageUpload).not.toHaveBeenCalled()
})

it('still exports an empty backup when the database is genuinely empty', async () => {
  const data = await collectExportData()

  expect(data.hosts).toEqual([])
  expect(data.hosts).not.toBeUndefined()
  expect(data.knownHosts).toEqual([])
  expect(data.sshKeys).toEqual([])
  expect(data.settings).toEqual({})
  expect(data.exportedBy).toBe('user-1')
})
