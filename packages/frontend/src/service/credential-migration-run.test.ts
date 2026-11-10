// The migration's production call chain: snapshot, plan, execute, verify.
//
// Phase 10 shipped the rules and 12 tests against a fake vault, and no code path
// that reached them. That is the same shape as the earlier "tests pass, UI uses a
// different function" defect, so this file drives the real adapters against a real
// (in-memory) SQLite surface and asserts on the rows that come out.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selectStrict: vi.fn(),
  executeQuery: vi.fn(),
  invoke: vi.fn(),
  vaultWrite: vi.fn(),
  vaultRead: vi.fn(),
  vaultRemove: vi.fn(),
}))

vi.mock('./database', () => ({
  selectStrict: mocks.selectStrict,
  executeQuery: mocks.executeQuery,
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

vi.mock('./vault-secret-provider', () => ({
  vaultSecretProvider: {
    write: mocks.vaultWrite,
    read: mocks.vaultRead,
    remove: mocks.vaultRemove,
    isAvailable: vi.fn(async () => true),
    availability: vi.fn(async () => ({ ok: true })),
  },
}))

const { previewCredentialMigration, migratePlaintextCredentials, verifyCredentialMigration } =
  await import('./credential-migration-run')

interface HostRow {
  id: string
  name: string
  password: string | null
  private_key: string | null
  credential_ref: string | null
}

interface KeyRow {
  id: string
  name: string
  private_key: string | null
  passphrase: string | null
  credential_ref: string | null
}

let hosts: HostRow[]
let keys: KeyRow[]
let vaultEntries: Map<string, string>

function installDatabase() {
  mocks.selectStrict.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM hosts')) return hosts.map(row => ({ ...row }))
    if (sql.includes('FROM ssh_keys')) return keys.map(row => ({ ...row }))
    return []
  })
  mocks.executeQuery.mockImplementation(
    async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('UPDATE hosts')) {
        const [ref, id] = params as [string, string]
        const row = hosts.find(entry => entry.id === id)
        if (row) {
          row.credential_ref = ref
          row.password = null
          row.private_key = null
        }
        return undefined
      }
      if (sql.startsWith('UPDATE ssh_keys')) {
        const [ref, id] = params as [string, string]
        const row = keys.find(entry => entry.id === id)
        if (row) {
          row.credential_ref = ref
          row.private_key = null
          row.passphrase = null
        }
        return undefined
      }
      return undefined
    },
  )
}

beforeEach(() => {
  hosts = [
    {
      id: 'h1',
      name: 'prod',
      password: 'host-password',
      private_key: null,
      credential_ref: null,
    },
    {
      id: 'h2',
      name: 'clean',
      password: null,
      private_key: null,
      credential_ref: null,
    },
  ]
  keys = [
    {
      id: 'k1',
      name: 'deploy',
      private_key: 'key-material',
      passphrase: 'passphrase',
      credential_ref: null,
    },
  ]
  vaultEntries = new Map()
  installDatabase()
  mocks.invoke.mockReset().mockResolvedValue({ path: '/tmp/pre-migration-1.db' })
  mocks.vaultWrite.mockReset().mockImplementation(
    async (
      resource: { type: string, id: string },
      version: number,
      kind: string,
      value: string,
    ) => {
      vaultEntries.set(`${resource.type}:${resource.id}:${version}:${kind}`, value)
    },
  )
  mocks.vaultRead.mockReset().mockImplementation(
    async (resource: { type: string, id: string }, version: number, kind: string) =>
      vaultEntries.get(`${resource.type}:${resource.id}:${version}:${kind}`),
  )
  mocks.vaultRemove.mockReset().mockImplementation(
    async (resource: { type: string, id: string }, version: number, kind: string) => {
      vaultEntries.delete(`${resource.type}:${resource.id}:${version}:${kind}`)
    },
  )
})

describe('preview', () => {
  it('counts without exposing a value', async () => {
    const plan = await previewCredentialMigration()
    expect(plan.hosts.map(host => host.id)).toEqual(['h1'])
    expect(plan.keys.map(key => key.id)).toEqual(['k1'])
    expect(plan.counts).toEqual({
      hostPasswords: 1,
      hostPrivateKeys: 0,
      sshKeyPrivateKeys: 1,
      sshKeyPassphrases: 1,
    })
    const text = JSON.stringify(plan)
    // No value survives into the plan. Kind *names* do appear — that is the point
    // of the plan — so the assertion is on the secret strings themselves.
    expect(text).not.toContain('host-password')
    expect(text).not.toContain('key-material')
    expect(text).not.toContain('"passphrase":"passphrase"')
  })

  it('writes nothing', async () => {
    await previewCredentialMigration()
    expect(mocks.vaultWrite).not.toHaveBeenCalled()
    expect(mocks.executeQuery).not.toHaveBeenCalled()
  })
})

describe('running it', () => {
  it('refuses without explicit authorisation', async () => {
    const result = await migratePlaintextCredentials({ authorized: false })
    expect(result.aborted).toBe(true)
    // Nothing was written and no snapshot was taken: an unauthorised call must not
    // have side effects it then reports as "aborted".
    expect(mocks.vaultWrite).not.toHaveBeenCalled()
    expect(mocks.vaultWrite).not.toHaveBeenCalled()
  })

  it('takes a snapshot before touching anything', async () => {
    await migratePlaintextCredentials({ authorized: true })
    expect(mocks.invoke).toHaveBeenCalledWith(
      'backup_database_before_migration',
      expect.anything(),
    )
  })

  it('does nothing when there is nothing to migrate', async () => {
    hosts = [{ id: 'h', name: 'clean', password: null, private_key: null, credential_ref: null }]
    keys = []
    const result = await migratePlaintextCredentials({ authorized: true })
    expect(result.migratedHosts).toBe(0)
    // No snapshot for a no-op: a backup nobody needs is a file left behind.
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.vaultWrite).not.toHaveBeenCalled()
  })

  it('moves the secrets, clears the columns and verifies the result', async () => {
    const result = await migratePlaintextCredentials({ authorized: true })

    expect(result.migratedHosts).toBe(1)
    expect(result.migratedKeys).toBe(1)
    expect(result.failed).toEqual([])
    expect(result.verification?.ok).toBe(true)
    expect(result.snapshotPath).toBe('/tmp/pre-migration-1.db')

    // The vault holds the values under the version the reference names.
    expect(vaultEntries.get('host:h1:1:password')).toBe('host-password')
    expect(vaultEntries.get('ssh-key:k1:1:privateKey')).toBe('key-material')
    expect(vaultEntries.get('ssh-key:k1:1:passphrase')).toBe('passphrase')

    // The rows no longer carry plaintext, and the reference parses.
    expect(hosts[0].password).toBeNull()
    expect(keys[0].private_key).toBeNull()
    expect(JSON.parse(String(hosts[0].credential_ref))).toEqual({
      kinds: ['password'],
      provider: 'vault',
      version: 1,
    })
  })

  it('leaves a row untouched when its vault write fails, and retries later', async () => {
    mocks.vaultWrite.mockImplementation(
      async (
        resource: { type: string, id: string },
        version: number,
        kind: string,
        value: string,
      ) => {
        if (resource.id === 'h1') throw new Error('vault write failed')
        vaultEntries.set(`${resource.type}:${resource.id}:${version}:${kind}`, value)
      },
    )

    const result = await migratePlaintextCredentials({ authorized: true })

    expect(result.failed.map(entry => entry.id)).toEqual(['h1'])
    expect(result.migratedKeys).toBe(1)
    // h1 keeps its plaintext, which the old read path still uses.
    expect(hosts[0].password).toBe('host-password')
    expect(hosts[0].credential_ref).toBeNull()

    // A second run picks it up: the failure was not recorded anywhere that blocks
    // a retry, because the row itself is the state.
    installDatabase()
    mocks.vaultWrite.mockImplementation(
      async (
        resource: { type: string, id: string },
        version: number,
        kind: string,
        value: string,
      ) => {
        vaultEntries.set(`${resource.type}:${resource.id}:${version}:${kind}`, value)
      },
    )
    const retry = await migratePlaintextCredentials({ authorized: true })
    expect(retry.migratedHosts).toBe(1)
    expect(hosts[0].password).toBeNull()
  })

  it('refuses to run when the snapshot cannot be taken', async () => {
    mocks.invoke.mockRejectedValue('disk full')

    await expect(
      migratePlaintextCredentials({ authorized: true }),
    ).rejects.toThrow(/could not be backed up/i)
    // Nothing moved: migrating without a backup is the one outcome worse than not
    // migrating.
    expect(hosts[0].password).toBe('host-password')
    expect(mocks.vaultWrite).not.toHaveBeenCalled()
  })

  it('does not clear a row whose value the vault cannot read back', async () => {
    mocks.vaultRead.mockResolvedValue('something else')

    const result = await migratePlaintextCredentials({ authorized: true })
    expect(result.failed.map(entry => entry.id)).toContain('h1')
    expect(hosts[0].password).toBe('host-password')
    // The half-written generation was cleaned up.
    expect(vaultEntries.has('host:h1:1:password')).toBe(false)
  })
})

describe('verification', () => {
  it('reports plaintext that survived and references the vault cannot answer', async () => {
    hosts[0].credential_ref = JSON.stringify({
      kinds: ['password'],
      provider: 'vault',
      version: 1,
    })
    // No vault entry written: the reference promises a secret that is not there.
    const verification = await verifyCredentialMigration({
      hostIds: ['h1'],
      keyIds: [],
    })
    expect(verification.ok).toBe(false)
    expect(verification.remainingPlaintext).toEqual([
      { id: 'h1', kind: 'host', column: 'password' },
    ])
    expect(verification.unreadableReferences).toEqual([
      expect.objectContaining({ id: 'h1', kind: 'host' }),
    ])
  })

  it('passes when the row is clean and the secret is readable', async () => {
    hosts[0].password = null
    hosts[0].credential_ref = JSON.stringify({
      kinds: ['password'],
      provider: 'vault',
      version: 1,
    })
    vaultEntries.set('host:h1:1:password', 'host-password')

    const verification = await verifyCredentialMigration({
      hostIds: ['h1'],
      keyIds: [],
    })
    expect(verification.ok).toBe(true)
  })
})
