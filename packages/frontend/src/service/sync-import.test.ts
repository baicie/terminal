import { beforeEach, expect, it, vi } from 'vitest'
import type { ExportData } from './sync-types'
import {
  createImportStats,
  importResources,
  type ImportPayload,
} from './sync-import'
import {
  normalizeImportedAgentForwarding,
  normalizeImportedShellIntegration,
} from './sync-import-support'

const core = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: core.invoke }))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

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

/** The one command call the restore is allowed to make. */
function commandPayload(): ImportPayload {
  expect(core.invoke).toHaveBeenCalledTimes(1)
  const [command, args] = core.invoke.mock.calls[0] as [
    string,
    { payload: ImportPayload },
  ]
  expect(command).toBe('import_backup_data')
  return args.payload
}

beforeEach(() => {
  core.invoke.mockReset().mockResolvedValue(createImportStats())
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
  expect(commandPayload()).toMatchObject({
    mergeMode: 'merge',
    settings: { app_settings: '{"theme":"dark"}' },
  })

  core.invoke.mockClear()
  await importResources(data, 'replace', createImportStats())
  expect(commandPayload()).toMatchObject({
    mergeMode: 'replace',
    settings: { app_settings: '{"theme":"dark"}' },
  })
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

  expect(commandPayload().hosts).toContainEqual(
    expect.objectContaining({
      certificate: 'certificate',
      jump_host_id: 'jump-id',
      jump_host_auth_type: 'agent',
      agent_forwarding: 1,
      shell_integration: 'bash',
    }),
  )
})

it('normalizes lossy switches before they leave the frontend', async () => {
  await importResources(
    exportData({
      hosts: [
        { id: 'host-id', agent_forwarding: '1', shell_integration: true },
        { id: 'other-id', agent_forwarding: false, shell_integration: 'zsh' },
      ],
    }),
    'merge',
    createImportStats(),
  )

  const hosts = commandPayload().hosts as Record<string, unknown>[]
  expect(hosts[0]).toMatchObject({ agent_forwarding: 0, shell_integration: 'off' })
  expect(hosts[1]).toMatchObject({ agent_forwarding: 0, shell_integration: 'zsh' })
})

it('runs the whole restore through one command call', async () => {
  await importResources(
    exportData({
      groups: [{ id: 'g1', name: 'Group' }],
      hosts: [{ id: 'h1', name: 'Host' }],
      snippetPackages: [{ id: 'p1', name: 'Package' }],
      snippets: [{ id: 's1', name: 'Snippet', script: '' }],
      sshKeys: [{ id: 'k1', name: 'Key' }],
      knownHosts: [{ hostname: 'target.example', port: 22 }],
      workspaces: [{ id: 'w1', name: 'Workspace' }],
      workspaceLayouts: [{ workspaceId: 'w1', layoutData: { tabs: [] } }],
      settings: { app_settings: '{}' },
    }),
    'merge',
    createImportStats(),
  )

  // The batch used to be 40+ separate statements bracketed by a BEGIN that a
  // pooled connection was free to ignore.
  const payload = commandPayload()
  expect(payload.groups).toHaveLength(1)
  expect(payload.hosts).toHaveLength(1)
  expect(payload.snippetPackages).toHaveLength(1)
  expect(payload.snippets).toHaveLength(1)
  expect(payload.sshKeys).toHaveLength(1)
  expect(payload.knownHosts).toHaveLength(1)
  expect(payload.workspaces).toHaveLength(1)
  expect(payload.workspaceLayouts).toHaveLength(1)
  expect(payload.settings).toEqual({ app_settings: '{}' })
  expect(typeof payload.now).toBe('number')
})

it('surfaces a rolled back restore and leaves the counters untouched', async () => {
  core.invoke.mockRejectedValueOnce(
    'import was rolled back after NOT NULL constraint failed: hosts.name',
  )
  const stats = createImportStats()

  await expect(
    importResources(
      exportData({ hosts: [{ id: 'h1', name: 'Host' }] }),
      'merge',
      stats,
    ),
  ).rejects.toThrow('NOT NULL constraint failed')

  expect(core.invoke).toHaveBeenCalledTimes(1)
  expect(stats).toEqual(createImportStats())
})

it('mints a fresh id for every imported known host', async () => {
  await importResources(
    exportData({
      knownHosts: [
        {
          id: 'stale-id',
          hostname: 'target.example',
          port: 22,
          fingerprint: 'SHA256:newfingerprint',
          key_type: 'ssh-ed25519',
          added_at: 7,
        },
        { hostname: 'other.example', port: 2222, fingerprint: 'SHA256:other' },
      ],
    }),
    'replace',
    createImportStats(),
  )

  const knownHosts = commandPayload().knownHosts as Record<string, unknown>[]
  expect(knownHosts).toHaveLength(2)
  expect(knownHosts[0]).toMatchObject({
    hostname: 'target.example',
    port: 22,
    fingerprint: 'SHA256:newfingerprint',
    key_type: 'ssh-ed25519',
    added_at: 7,
  })
  expect(knownHosts[0]?.id).toMatch(UUID)
  expect(knownHosts[1]?.id).toMatch(UUID)
  expect(knownHosts[0]?.id).not.toBe(knownHosts[1]?.id)
  expect(knownHosts[0]?.id).not.toBe('stale-id')
})

it('writes the reported counters back into the caller stats object', async () => {
  core.invoke.mockResolvedValueOnce({
    hosts: 2,
    groups: 1,
    snippets: 3,
    snippetPackages: 4,
    sshKeys: 5,
    knownHosts: 6,
    workspaces: 7,
  })
  const stats = { ...createImportStats(), members: 9 }

  await importResources(exportData(), 'merge', stats)

  expect(stats).toEqual({
    hosts: 2,
    groups: 1,
    snippets: 3,
    snippetPackages: 4,
    sshKeys: 5,
    knownHosts: 6,
    workspaces: 7,
    members: 9,
  })
})
