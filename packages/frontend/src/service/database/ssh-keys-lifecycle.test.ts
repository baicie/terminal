// The ssh key lifecycle, end to end at the service layer: create, import, edit,
// delete, view, copy, use.
//
// The gap this closes: the secrets were being written to the vault correctly, but
// `getSSHKeySecret` had no caller. A key could be saved and then never read again —
// so "stored safely" and "unusable" were the same state.
//
// Also locked here: hosts and keys use *separate* vault namespaces. They used to
// share `host:<id>:…`, which meant a host and a key with the same id could read
// each other's secret.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  select: vi.fn(),
  vaultWrite: vi.fn(),
  vaultRead: vi.fn(),
  vaultRemove: vi.fn(),
  vaultRemoveVersion: vi.fn(),
}))

vi.mock('./connection', () => ({
  executeQuery: mocks.executeQuery,
  select: mocks.select,
  selectStrict: mocks.select,
}))

vi.mock('@/service/vault-secret-provider', () => ({
  vaultSecretProvider: {
    write: mocks.vaultWrite,
    read: mocks.vaultRead,
    remove: mocks.vaultRemove,
    removeVersion: mocks.vaultRemoveVersion,
    isAvailable: vi.fn(async () => true),
    availability: vi.fn(async () => ({ ok: true })),
  },
}))

const {
  createSSHKey,
  updateSSHKey,
  deleteSSHKey,
  getSSHKeySecret,
  getSSHKeyCredentials,
  getSSHKeys,
} = await import('./ssh-keys')

const PRIVATE_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----'
const PASSPHRASE = 'key-passphrase'

let entries: Map<string, string>

function keyName(resource: { type: string, id: string }, version: number, kind: string) {
  return `${resource.type}:${resource.id}:${version}:${kind}`
}

function keyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'key-1',
    name: 'deploy',
    key_type: 'ssh-ed25519',
    private_key: null,
    public_key: 'ssh-ed25519 AAAA',
    certificate: null,
    passphrase: null,
    credential_ref: JSON.stringify({
      kinds: ['privateKey', 'passphrase'],
      provider: 'vault',
      version: 1,
    }),
    is_encrypted: 1,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  }
}

beforeEach(() => {
  entries = new Map()
  mocks.executeQuery.mockReset().mockResolvedValue(undefined)
  mocks.select.mockReset()
  mocks.vaultWrite.mockReset().mockImplementation(
    async (
      resource: { type: string, id: string },
      version: number,
      kind: string,
      value: string,
    ) => {
      entries.set(keyName(resource, version, kind), value)
    },
  )
  mocks.vaultRead.mockReset().mockImplementation(
    async (resource: { type: string, id: string }, version: number, kind: string) =>
      entries.get(keyName(resource, version, kind)),
  )
  mocks.vaultRemove.mockReset().mockResolvedValue(undefined)
  mocks.vaultRemoveVersion.mockReset().mockImplementation(
    async (resource: { type: string, id: string }, version: number, kinds: string[]) => {
      for (const kind of kinds) entries.delete(keyName(resource, version, kind))
      return []
    },
  )
})

describe('create', () => {
  it('stores the private half in the vault and keeps the row clean', async () => {
    await createSSHKey({
      id: 'key-1',
      name: 'deploy',
      key_type: 'ssh-ed25519',
      private_key: PRIVATE_KEY,
      public_key: 'ssh-ed25519 AAAA',
      certificate: null,
      passphrase: PASSPHRASE,
      is_encrypted: 1,
    } as never)

    expect(entries.get('ssh-key:key-1:1:privateKey')).toBe(PRIVATE_KEY)
    expect(entries.get('ssh-key:key-1:1:passphrase')).toBe(PASSPHRASE)

    const insert = mocks.executeQuery.mock.calls.find(([sql]) =>
      String(sql).startsWith('INSERT INTO ssh_keys'),
    )
    expect(insert).toBeDefined()
    expect(String(insert?.[0])).toMatch(/NULL/) // private_key and passphrase
    const params = JSON.stringify(insert?.[1])
    expect(params).not.toContain('BEGIN OPENSSH')
    expect(params).not.toContain(PASSPHRASE)
    // The reference records both kinds and the version.
    expect(params).toContain('\\"version\\":1')
  })

  it('a public-only key stores no reference and touches no vault', async () => {
    await createSSHKey({
      id: 'key-2',
      name: 'public',
      key_type: 'ssh-ed25519',
      private_key: null,
      public_key: 'ssh-ed25519 AAAA',
      certificate: null,
      passphrase: null,
      is_encrypted: 0,
    } as never)

    expect(mocks.vaultWrite).not.toHaveBeenCalled()
    const insert = mocks.executeQuery.mock.calls.find(([sql]) =>
      String(sql).startsWith('INSERT INTO ssh_keys'),
    )
    const params = insert?.[1] as unknown[]
    // credential_ref is NULL for a key with nothing stored.
    expect(params.some(value => value === null)).toBe(true)
    expect(JSON.stringify(params)).not.toContain('provider')
  })
})

describe('view and copy', () => {
  it('reads the private key on demand, not as part of a list read', async () => {
    entries.set('ssh-key:key-1:1:privateKey', PRIVATE_KEY)
    mocks.select.mockResolvedValue([keyRow()])

    const value = await getSSHKeySecret('key-1', 'privateKey')
    expect(value).toBe(PRIVATE_KEY)
    // It read the vault, using the version the row names.
    expect(mocks.vaultRead).toHaveBeenCalledWith(
      { type: 'ssh-key', id: 'key-1' },
      1,
      'privateKey',
    )
  })

  it('a list read never returns a secret', async () => {
    mocks.select.mockResolvedValue([keyRow()])
    const keys = await getSSHKeys()
    expect(mocks.vaultRead).not.toHaveBeenCalled()
    expect(JSON.stringify(keys)).not.toContain('BEGIN OPENSSH')
  })

  it('asks for nothing when the row records no such kind', async () => {
    mocks.select.mockResolvedValue([keyRow()])
    const value = await getSSHKeySecret('key-1', 'passphrase')
    // The reference lists both kinds here, so the vault is consulted; a row listing
    // only privateKey must not be asked for a passphrase.
    expect(value).toBeUndefined()

    mocks.select.mockResolvedValue([
      keyRow({
        credential_ref: JSON.stringify({
          kinds: ['privateKey'],
          provider: 'vault',
          version: 1,
        }),
      }),
    ])
    mocks.vaultRead.mockClear()
    expect(await getSSHKeySecret('key-1', 'passphrase')).toBeUndefined()
    expect(mocks.vaultRead).not.toHaveBeenCalled()
  })

  it('a row with no reference reads nothing', async () => {
    mocks.select.mockResolvedValue([keyRow({ credential_ref: null })])
    expect(await getSSHKeySecret('key-1', 'privateKey')).toBeUndefined()
    expect(mocks.vaultRead).not.toHaveBeenCalled()
  })

  it('returns both halves for a connection', async () => {
    entries.set('ssh-key:key-1:1:privateKey', PRIVATE_KEY)
    entries.set('ssh-key:key-1:1:passphrase', PASSPHRASE)
    mocks.select.mockResolvedValue([keyRow()])

    expect(await getSSHKeyCredentials('key-1')).toEqual({
      privateKey: PRIVATE_KEY,
      passphrase: PASSPHRASE,
    })
  })

  it('a missing key returns nothing rather than throwing', async () => {
    mocks.select.mockResolvedValue([])
    expect(await getSSHKeySecret('gone', 'privateKey')).toBeUndefined()
  })
})

describe('edit', () => {
  it('writes a new version and retires the old one', async () => {
    entries.set('ssh-key:key-1:1:privateKey', 'old-key')
    mocks.select.mockResolvedValue([keyRow()])

    await updateSSHKey('key-1', { private_key: PRIVATE_KEY })

    expect(entries.get('ssh-key:key-1:2:privateKey')).toBe(PRIVATE_KEY)
    expect(entries.has('ssh-key:key-1:1:privateKey')).toBe(false)
  })

  it('keeps the kinds the row already had when only one is re-entered', async () => {
    entries.set('ssh-key:key-1:1:privateKey', 'old-key')
    entries.set('ssh-key:key-1:1:passphrase', 'old-pass')
    mocks.select.mockResolvedValue([keyRow()])

    // The user retyped the key but not the passphrase.
    await updateSSHKey('key-1', { private_key: PRIVATE_KEY })

    const update = mocks.executeQuery.mock.calls.find(([sql]) =>
      String(sql).startsWith('UPDATE ssh_keys'),
    )
    const ref = (update?.[1] as unknown[]).find(
      value => typeof value === 'string' && value.includes('provider'),
    )
    // Both kinds stay listed, or the passphrase would become unreadable.
    expect(JSON.parse(String(ref)).kinds.sort()).toEqual(['passphrase', 'privateKey'])
    // The passphrase itself was not rewritten, so it is not in the new version.
    expect(entries.has('ssh-key:key-1:2:passphrase')).toBe(false)
  })

  it('keeps the old version when the row update fails', async () => {
    entries.set('ssh-key:key-1:1:privateKey', 'old-key')
    mocks.select.mockResolvedValue([keyRow()])
    mocks.executeQuery.mockRejectedValue(new Error('database is locked'))

    await expect(
      updateSSHKey('key-1', { private_key: PRIVATE_KEY }),
    ).rejects.toThrow(/database is locked/)

    expect(entries.get('ssh-key:key-1:1:privateKey')).toBe('old-key')
    expect(entries.has('ssh-key:key-1:2:privateKey')).toBe(false)
  })

  it('a rename touches neither the vault nor the secret columns', async () => {
    mocks.select.mockResolvedValue([keyRow()])
    await updateSSHKey('key-1', { name: 'renamed' })

    expect(mocks.vaultWrite).not.toHaveBeenCalled()
    const update = mocks.executeQuery.mock.calls.find(([sql]) =>
      String(sql).startsWith('UPDATE ssh_keys'),
    )
    // The secret columns are guarded by a marker that is 0 here, so the values the
    // row still holds survive the rename.
    const params = update?.[1] as unknown[]
    expect(params[2]).toBe(0)
    expect(params[5]).toBe(0)
  })
})

describe('delete', () => {
  it('removes the row first, then the version it pointed at', async () => {
    const order: string[] = []
    mocks.executeQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('DELETE FROM ssh_keys')) order.push('row')
    })
    mocks.vaultRemoveVersion.mockImplementation(async () => {
      order.push('vault')
      return []
    })
    mocks.select.mockResolvedValue([keyRow()])

    await deleteSSHKey('key-1')
    expect(order).toEqual(['row', 'vault'])
    expect(mocks.vaultRemoveVersion).toHaveBeenCalledWith(
      { type: 'ssh-key', id: 'key-1' },
      1,
      ['privateKey', 'passphrase'],
    )
  })

  it('a locked vault does not make a completed delete look failed', async () => {
    mocks.select.mockResolvedValue([keyRow()])
    mocks.vaultRemoveVersion.mockRejectedValue(new Error('vault locked'))
    await expect(deleteSSHKey('key-1')).resolves.toBeUndefined()
  })

  it('a key with no reference has nothing to remove', async () => {
    mocks.select.mockResolvedValue([keyRow({ credential_ref: null })])
    await deleteSSHKey('key-1')
    expect(mocks.vaultRemoveVersion).not.toHaveBeenCalled()
  })
})

describe('namespaces', () => {
  it('a host and a key with the same id cannot read each other', async () => {
    // Same id, deliberately.
    entries.set('ssh-key:shared:1:privateKey', 'key-secret')
    entries.set('host:shared:1:privateKey', 'host-secret')
    mocks.select.mockResolvedValue([keyRow({ id: 'shared' })])

    expect(await getSSHKeySecret('shared', 'privateKey')).toBe('key-secret')
  })
})
