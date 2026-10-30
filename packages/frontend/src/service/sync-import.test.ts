import { beforeEach, expect, it, vi } from 'vitest'
import type { ExportData } from './sync-types'
import { createImportStats, importResources } from './sync-import'
import {
  normalizeImportedAgentForwarding,
  normalizeImportedShellIntegration,
} from './sync-import-support'

const database = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  load: vi.fn(),
  selectStrict: vi.fn(),
}))

vi.mock('@/service/database', () => ({
  executeQuery: database.executeQuery,
  selectStrict: database.selectStrict,
}))
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: database.load },
}))

const SETTINGS_INSERT = 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'

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
  database.executeQuery.mockReset().mockResolvedValue(undefined)
  database.load.mockReset().mockResolvedValue({ execute: database.executeQuery })
  database.selectStrict.mockReset().mockResolvedValue([])
})

it('only enables imported agent forwarding for explicit boolean values', () => {
  expect(normalizeImportedAgentForwarding(true)).toBe(1)
  expect(normalizeImportedAgentForwarding(1)).toBe(1)
  expect(normalizeImportedAgentForwarding(false)).toBe(0)
  expect(normalizeImportedAgentForwarding(0)).toBe(0)
  expect(normalizeImportedAgentForwarding('1')).toBe(0)
  expect(normalizeImportedAgentForwarding('false')).toBe(0)
})

it('only enables imported shell integration for explicit bash or zsh values', () => {
  expect(normalizeImportedShellIntegration('bash')).toBe('bash')
  expect(normalizeImportedShellIntegration('zsh')).toBe('zsh')
  expect(normalizeImportedShellIntegration('off')).toBe('off')
  expect(normalizeImportedShellIntegration(true)).toBe('off')
  expect(normalizeImportedShellIntegration(undefined)).toBe('off')
})

it('restores settings with merge and replace semantics', async () => {
  const data = exportData({ settings: { app_settings: '{"theme":"dark"}' } })

  await importResources(data, 'merge', createImportStats())
  expect(database.executeQuery).toHaveBeenCalledWith(SETTINGS_INSERT, [
    'app_settings',
    '{"theme":"dark"}',
  ])
  expect(database.executeQuery).toHaveBeenLastCalledWith('COMMIT')

  database.executeQuery.mockClear()
  database.selectStrict.mockResolvedValueOnce([{ id: 'app_settings' }])
  await importResources(data, 'merge', createImportStats())
  expect(database.executeQuery).not.toHaveBeenCalledWith(
    expect.stringContaining('INSERT OR REPLACE INTO settings'),
    expect.anything(),
  )

  database.selectStrict.mockResolvedValueOnce([{ id: 'app_settings' }])
  await importResources(data, 'replace', createImportStats())
  expect(database.executeQuery).toHaveBeenCalledWith(SETTINGS_INSERT, [
    'app_settings',
    '{"theme":"dark"}',
  ])
  expect(database.executeQuery).toHaveBeenLastCalledWith('COMMIT')
})

it('restores certificate and jump host columns from a full backup', async () => {
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
          agent_forwarding: 1,
          shell_integration: 'bash',
          created_at: 1,
          updated_at: 1,
        },
      ],
    }),
    'replace',
    createImportStats(),
  )

  expect(database.executeQuery).toHaveBeenCalledWith(
    expect.stringContaining('shell_integration'),
    expect.arrayContaining(['certificate', 'jump-id', 'agent', 1, 'bash']),
  )
})

it('runs the whole restore on the shared connection inside one transaction', async () => {
  await importResources(
    exportData({ settings: { app_settings: '{}' } }),
    'merge',
    createImportStats(),
  )

  // Importing used to open a second connection per statement.
  expect(database.load).not.toHaveBeenCalled()
  const statements = database.executeQuery.mock.calls.map(call => call[0])
  expect(statements[0]).toBe('BEGIN IMMEDIATE')
  expect(statements.at(-1)).toBe('COMMIT')
})

it('rolls the whole restore back when a statement fails halfway through', async () => {
  database.executeQuery.mockImplementation((sql: string) =>
    sql.startsWith('INSERT INTO snippet_packages')
      ? Promise.reject(new Error('disk full'))
      : Promise.resolve(undefined),
  )

  await expect(
    importResources(
      exportData({
        snippetPackages: [{ id: 'pkg-1', name: 'Package' }],
        snippets: [{ id: 'snippet-1', name: 'Snippet', script: '' }],
      }),
      'merge',
      createImportStats(),
    ),
  ).rejects.toThrow('disk full')

  const statements = database.executeQuery.mock.calls.map(call => call[0])
  expect(statements).toContain('BEGIN IMMEDIATE')
  expect(statements.at(-1)).toBe('ROLLBACK')
  expect(statements).not.toContain('COMMIT')
})

it('updates the fingerprint of an existing known host in replace mode', async () => {
  database.selectStrict.mockResolvedValue([{ id: 'known-host-1' }])

  await importResources(
    exportData({
      knownHosts: [
        {
          hostname: 'target.example',
          port: 22,
          fingerprint: 'SHA256:newfingerprint',
          key_type: 'ssh-ed25519',
          added_at: 7,
        },
      ],
    }),
    'replace',
    createImportStats(),
  )

  expect(database.executeQuery).toHaveBeenCalledWith(
    expect.stringContaining('UPDATE known_hosts SET fingerprint'),
    ['SHA256:newfingerprint', 'ssh-ed25519', 7, 'target.example', 22],
  )
})
