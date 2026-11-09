// A team package is a file on disk, so it needs the same whitelist as the plain
// export. The first version of the export hardening covered only `sync-export.ts`
// and left this path doing `SELECT *` straight into `JSON.stringify`, which wrote
// every pre-migration plaintext credential into the file.

import { describe, expect, it, vi } from 'vitest'

const LEGACY_HOST_ROW = {
  id: 'host-1',
  name: 'prod',
  hostname: 'prod.example.test',
  port: 22,
  username: 'alice',
  auth_type: 'password',
  password: 'legacy-plaintext-password',
  private_key:
    '-----BEGIN OPENSSH PRIVATE KEY-----\nlegacy\n-----END OPENSSH PRIVATE KEY-----',
  passphrase: 'legacy-passphrase',
  certificate: null,
  credential_ref: null,
  group_id: null,
  is_favorite: 1,
  color: null,
  tags: null,
  port_forwards: '[]',
  startup_command: null,
  environment: null,
  jump_host_id: null,
  jump_host_auth_type: null,
  agent_forwarding: 0,
  shell_integration: 'off',
  created_at: 1,
  updated_at: 2,
}

const LEGACY_KEY_ROW = {
  id: 'key-1',
  name: 'work key',
  key_type: 'ed25519',
  private_key:
    '-----BEGIN OPENSSH PRIVATE KEY-----\nlegacykey\n-----END OPENSSH PRIVATE KEY-----',
  public_key: 'ssh-ed25519 AAAA',
  certificate: null,
  passphrase: 'key-passphrase',
  is_encrypted: 1,
  created_at: 1,
  updated_at: 2,
}

let written = ''

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(async () => '/tmp/team-package.json'),
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(async (_path: string, contents: string) => {
    written = contents
  }),
}))

vi.mock('@/service/database', () => ({
  getUserProfile: vi.fn(async () => ({ id: 'user-1' })),
  // Answer per table: returning the host row for every table put a `password`
  // into the exported groups array, which the test then blamed on the product.
  selectStrict: vi.fn(async (sql: string) => {
    if (sql.includes('FROM hosts')) return [LEGACY_HOST_ROW]
    return []
  }),
}))

vi.mock('@/service/database/known-hosts', () => ({
  getKnownHosts: vi.fn(async () => []),
}))

vi.mock('@/service/database/ssh-keys', () => ({
  getSSHKeys: vi.fn(async () => [LEGACY_KEY_ROW]),
}))

vi.mock('@/service/database/workspaces', () => ({
  getWorkspaces: vi.fn(async () => []),
  getWorkspaceLayout: vi.fn(async () => ''),
}))

vi.mock('./sync-import', () => ({
  createImportStats: vi.fn(),
  importResources: vi.fn(),
}))

vi.mock('./sync-export', () => ({
  assertExportTablesReadable: vi.fn(async () => undefined),
}))

const { exportTeamPackage } = await import('./sync-team')

describe('a team package carries no secret material', () => {
  it('does not write a legacy host password into the file', async () => {
    written = ''
    await exportTeamPackage({ includeHosts: true, includeSSHKeys: true })
    expect(written).not.toContain('legacy-plaintext-password')
  })

  it('does not write a legacy private key or passphrase into the file', async () => {
    written = ''
    await exportTeamPackage({ includeHosts: true, includeSSHKeys: true })
    expect(written).not.toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(written).not.toContain('legacy-passphrase')
    expect(written).not.toContain('key-passphrase')
  })

  it('still carries what a restore needs', async () => {
    written = ''
    await exportTeamPackage({ includeHosts: true, includeSSHKeys: true })
    const parsed = JSON.parse(written) as {
      hosts: Array<Record<string, unknown>>
      sshKeys: Array<Record<string, unknown>>
    }
    expect(parsed.hosts[0]).toMatchObject({
      id: 'host-1',
      name: 'prod',
      hostname: 'prod.example.test',
      username: 'alice',
    })
    expect(parsed.sshKeys[0]).toMatchObject({
      id: 'key-1',
      public_key: 'ssh-ed25519 AAAA',
    })
  })

  it('drops unknown columns added by a future schema', async () => {
    written = ''
    await exportTeamPackage({ includeHosts: true, includeSSHKeys: true })
    const parsed = JSON.parse(written) as {
      hosts: Array<Record<string, unknown>>
    }
    expect(Object.keys(parsed.hosts[0])).not.toContain('password')
    expect(Object.keys(parsed.hosts[0])).not.toContain('private_key')
  })
})
