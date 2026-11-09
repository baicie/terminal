// A plain JSON export must not contain a secret, even when the database still
// holds one from before the credential migration.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const LEGACY_PASSWORD = 'legacy-plaintext-password'
const LEGACY_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nlegacy\n-----END OPENSSH PRIVATE KEY-----'
const LEGACY_PASSPHRASE = 'legacy-key-passphrase'

const mocks = vi.hoisted(() => ({
  selectStrict: vi.fn(),
  getWorkspaces: vi.fn(async () => []),
  getWorkspaceLayout: vi.fn(async () => null),
  getSSHKeys: vi.fn(),
  getKnownHosts: vi.fn(async () => []),
  getUserProfile: vi.fn(async () => ({ id: 'user-1' })),
}))

vi.mock('@/service/database/connection', () => ({
  selectStrict: mocks.selectStrict,
  executeQuery: vi.fn(),
  select: mocks.selectStrict,
}))

vi.mock('@/service/database', () => ({
  selectStrict: mocks.selectStrict,
  getUserProfile: mocks.getUserProfile,
}))
vi.mock('@/service/database/ssh-keys', () => ({ getSSHKeys: mocks.getSSHKeys }))
vi.mock('@/service/database/known-hosts', () => ({ getKnownHosts: mocks.getKnownHosts }))
vi.mock('@/service/database/workspaces', () => ({
  getWorkspaces: mocks.getWorkspaces,
  getWorkspaceLayout: mocks.getWorkspaceLayout,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: vi.fn() }))

const { collectExportData } = await import('./sync-export')

const legacyHostRow = {
  id: 'host-1',
  name: 'prod',
  hostname: 'prod.example.test',
  port: 22,
  username: 'alice',
  auth_type: 'password',
  // Pre-migration plaintext still sitting in the column.
  password: LEGACY_PASSWORD,
  private_key: LEGACY_KEY,
  certificate: 'ssh-ed25519-cert-v01@openssh.com AAAA',
  credential_ref: JSON.stringify({ kinds: ['password'], provider: 'vault' }),
  group_id: null,
  is_favorite: 0,
  color: null,
  tags: null,
  port_forwards: '[]',
  startup_command: null,
  environment: null,
  jump_host_id: null,
  jump_host_auth_type: null,
  agent_forwarding: 0,
  shell_integration: 'off',
  created_at: 0,
  updated_at: 0,
}

const legacyKeyRow = {
  id: 'key-1',
  name: 'my key',
  key_type: 'ssh-ed25519',
  private_key: LEGACY_KEY,
  public_key: 'ssh-ed25519 AAAA',
  certificate: null,
  passphrase: LEGACY_PASSPHRASE,
  is_encrypted: 0,
  created_at: 0,
  updated_at: 0,
}

beforeEach(() => {
  mocks.selectStrict.mockReset()
  mocks.getSSHKeys.mockReset()
  mocks.selectStrict.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM hosts')) return [legacyHostRow]
    return []
  })
  mocks.getSSHKeys.mockResolvedValue([legacyKeyRow])
})

describe('plain export excludes secrets', () => {
  it('omits a legacy plaintext password from the exported hosts', async () => {
    const data = await collectExportData()
    const serialized = JSON.stringify(data)
    expect(serialized).not.toContain(LEGACY_PASSWORD)
  })

  it('omits a legacy private key', async () => {
    const data = await collectExportData()
    expect(JSON.stringify(data)).not.toContain('BEGIN OPENSSH')
  })

  it('omits an ssh key passphrase', async () => {
    const data = await collectExportData()
    expect(JSON.stringify(data)).not.toContain(LEGACY_PASSPHRASE)
  })

  it('keeps the host metadata a restore needs', async () => {
    const data = await collectExportData()
    expect(data.hosts).toHaveLength(1)
    expect(data.hosts[0]).toMatchObject({
      id: 'host-1',
      name: 'prod',
      hostname: 'prod.example.test',
      port: 22,
      username: 'alice',
      auth_type: 'password',
    })
  })

  it('carries the credential reference so the target device can rebind', async () => {
    const data = await collectExportData()
    const host = data.hosts[0] as unknown as { credential_ref: unknown }
    expect(host.credential_ref).toEqual({
      kinds: ['password'],
      provider: 'vault',
    })
  })

  it('keeps a public certificate: it is not a secret', async () => {
    const data = await collectExportData()
    expect(data.hosts[0]).toMatchObject({
      certificate: 'ssh-ed25519-cert-v01@openssh.com AAAA',
    })
  })

  it('exports ssh keys without their private material', async () => {
    const data = await collectExportData()
    expect(data.sshKeys).toHaveLength(1)
    expect(data.sshKeys[0]).toMatchObject({ id: 'key-1', name: 'my key' })
    expect(data.sshKeys[0]).not.toHaveProperty('private_key')
    expect(data.sshKeys[0]).not.toHaveProperty('passphrase')
  })

  it('does not depend on SELECT * staying the same shape', async () => {
    // A column added later must not leak by default: the export is built from a
    // whitelist, so an unknown field never reaches the file.
    mocks.selectStrict.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM hosts')) {
        return [{ ...legacyHostRow, some_new_secret_column: 'leaked-in-the-future' }]
      }
      return []
    })
    const data = await collectExportData()
    expect(JSON.stringify(data)).not.toContain('leaked-in-the-future')
  })
})
