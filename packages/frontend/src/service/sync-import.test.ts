import { beforeEach, expect, it, vi } from 'vitest'
import type { ExportData } from './sync-types'
import { createImportStats, importResources } from './sync-import'

const database = vi.hoisted(() => ({
  execute: vi.fn(),
  load: vi.fn(),
  select: vi.fn(),
}))

vi.mock('@/service/database', () => ({ select: database.select }))
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: database.load },
}))

function exportData(overrides: Partial<ExportData> = {}): ExportData {
  return {
    version: '1.0.0',
    exportedAt: 1,
    type: 'full',
    hosts: [],
    groups: [],
    snippets: [],
    snippetPackages: [],
    workspaces: [],
    workspaceLayouts: [],
    sshKeys: [],
    knownHosts: [],
    settings: {},
    ...overrides,
  }
}

beforeEach(() => {
  database.execute.mockReset().mockResolvedValue(undefined)
  database.load.mockReset().mockResolvedValue({ execute: database.execute })
  database.select.mockReset()
})

it('restores settings with merge and replace semantics', async () => {
  const data = exportData({ settings: { app_settings: '{"theme":"dark"}' } })

  database.select.mockResolvedValueOnce([])
  await importResources(data, 'merge', createImportStats())
  expect(database.execute).toHaveBeenLastCalledWith(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    ['app_settings', '{"theme":"dark"}'],
  )

  database.execute.mockClear()
  database.select.mockResolvedValueOnce([{ id: 'app_settings' }])
  await importResources(data, 'merge', createImportStats())
  expect(database.execute).not.toHaveBeenCalled()

  database.select.mockResolvedValueOnce([{ id: 'app_settings' }])
  await importResources(data, 'replace', createImportStats())
  expect(database.execute).toHaveBeenLastCalledWith(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    ['app_settings', '{"theme":"dark"}'],
  )
})

it('restores certificate and jump host columns from a full backup', async () => {
  database.select.mockResolvedValue([])
  await importResources(
    exportData({
      hosts: [
        {
          id: 'host-id',
          name: 'Target',
          hostname: 'target.example',
          port: 22,
          username: 'user',
          auth_type: 'key',
          password: null,
          private_key: 'private-key',
          certificate: 'certificate',
          group_id: null,
          is_favorite: 0,
          color: null,
          tags: null,
          port_forwards: '[]',
          startup_command: null,
          environment: null,
          jump_host_id: 'jump-id',
          jump_host_auth_type: 'agent',
          created_at: 1,
          updated_at: 1,
        },
      ],
    }),
    'replace',
    createImportStats(),
  )

  expect(database.execute).toHaveBeenCalledWith(
    expect.stringContaining('certificate'),
    expect.arrayContaining(['certificate', 'jump-id', 'agent']),
  )
})
