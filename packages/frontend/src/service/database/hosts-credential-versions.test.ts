// Versioned credentials: every failure point leaves either the old generation
// (complete) or the new one (complete), never a mixture.
//
// The defect this locks: with one fixed key per kind, updating a password *and* a
// private key wrote the password over the live one and then failed on the key. The
// row then had a new password and an old key — a combination that never existed and
// that nothing could roll back, because the old password was already gone.

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

vi.mock('@/store/host-mappers', () => ({
  hostRowToHost: (row: Record<string, unknown>) => ({
    ...row,
    authType: row.auth_type,
    credentialRef: row.credential_ref
      ? JSON.parse(String(row.credential_ref))
      : null,
    isFavorite: row.is_favorite === 1,
    portForwards: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }),
}))

const { createHost, updateHost, deleteHost } = await import('./hosts')

const PASSWORD = 'new-password-value'
const PRIVATE_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nnew\n-----END OPENSSH PRIVATE KEY-----'

/** A vault that behaves like the real one: writes land, reads see the latest. */
class FakeVault {
  readonly entries = new Map<string, string>()
  failWrite: { resourceId: string, kind: string } | null = null
  failRead: string | null = null

  key(resource: { type: string, id: string }, version: number, kind: string) {
    return `${resource.type}:${resource.id}:${version}:${kind}`
  }

  install() {
    mocks.vaultWrite.mockImplementation(
      async (resource: { type: string, id: string }, version: number, kind: string, value: string) => {
        if (
          this.failWrite &&
          this.failWrite.resourceId === resource.id &&
          this.failWrite.kind === kind
        ) {
          throw new Error('vault write failed')
        }
        this.entries.set(this.key(resource, version, kind), value)
      },
    )
    mocks.vaultRead.mockImplementation(
      async (resource: { type: string, id: string }, version: number, kind: string) => {
        if (this.failRead === kind) return 'corrupted'
        return this.entries.get(this.key(resource, version, kind))
      },
    )
    mocks.vaultRemoveVersion.mockImplementation(
      async (resource: { type: string, id: string }, version: number, kinds: string[]) => {
        for (const kind of kinds) this.entries.delete(this.key(resource, version, kind))
        return []
      },
    )
  }
}

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'host-1',
    name: 'prod',
    hostname: 'prod.example.test',
    port: 22,
    username: 'alice',
    auth_type: 'password',
    password: null,
    private_key: null,
    certificate: null,
    credential_ref: JSON.stringify({
      kinds: ['password'],
      provider: 'vault',
      version: 1,
    }),
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
    ...overrides,
  }
}

let vault: FakeVault

beforeEach(() => {
  mocks.executeQuery.mockReset().mockResolvedValue(undefined)
  mocks.select.mockReset()
  mocks.vaultWrite.mockReset()
  mocks.vaultRead.mockReset()
  mocks.vaultRemove.mockReset().mockResolvedValue(undefined)
  mocks.vaultRemoveVersion.mockReset().mockResolvedValue([])
  vault = new FakeVault()
  vault.install()
  vault.entries.set('host:host-1:1:password', 'old-password')
  mocks.select.mockResolvedValue([storedRow()])
})

describe('two secrets updated together', () => {
  it('writes both under one new version and switches the row once', async () => {
    await updateHost('host-1', { password: PASSWORD, privateKey: PRIVATE_KEY })

    // Both landed under version 2, not over version 1.
    expect(vault.entries.get('host:host-1:2:password')).toBe(PASSWORD)
    expect(vault.entries.get('host:host-1:2:privateKey')).toBe(PRIVATE_KEY)
    // The old generation is removed only after the row stopped pointing at it.
    expect(vault.entries.has('host:host-1:1:password')).toBe(false)

    const update = mocks.executeQuery.mock.calls.find(([sql]) =>
      String(sql).startsWith('UPDATE hosts'),
    )
    expect(update).toBeDefined()
    const ref = (update?.[1] as unknown[]).find(
      value => typeof value === 'string' && value.includes('"provider":"vault"'),
    )
    expect(JSON.parse(String(ref))).toEqual({
      kinds: ['password', 'privateKey'],
      provider: 'vault',
      version: 2,
    })
  })
})

describe('a failure part-way through never destroys the old credential', () => {
  it('keeps the old generation when the second write fails', async () => {
    vault.failWrite = { resourceId: 'host-1', kind: 'privateKey' }

    await expect(
      updateHost('host-1', { password: PASSWORD, privateKey: PRIVATE_KEY }),
    ).rejects.toThrow(/vault write failed/)

    // The old password is untouched, and no row update ran.
    expect(vault.entries.get('host:host-1:1:password')).toBe('old-password')
    expect(vault.entries.has('host:host-1:2:password')).toBe(false)
    expect(
      mocks.executeQuery.mock.calls.some(([sql]) =>
        String(sql).startsWith('UPDATE hosts'),
      ),
    ).toBe(false)
  })

  it('keeps the old generation when the SQLite update fails', async () => {
    mocks.executeQuery.mockRejectedValue(new Error('database is locked'))

    await expect(
      updateHost('host-1', { password: PASSWORD }),
    ).rejects.toThrow(/database is locked/)

    // The row still points at version 1, which still exists.
    expect(vault.entries.get('host:host-1:1:password')).toBe('old-password')
    // The unreachable new generation was cleaned up.
    expect(vault.entries.has('host:host-1:2:password')).toBe(false)
  })

  it('keeps the old generation when the read-back disagrees', async () => {
    vault.failRead = 'password'

    await expect(updateHost('host-1', { password: PASSWORD })).rejects.toThrow(
      /did not return/i,
    )
    expect(vault.entries.get('host:host-1:1:password')).toBe('old-password')
  })

  it('the row is still readable by the resolver after a failed update', async () => {
    mocks.executeQuery.mockRejectedValue(new Error('database is locked'))
    await expect(updateHost('host-1', { password: PASSWORD })).rejects.toBeDefined()

    // What a connection would read: the reference is still version 1 and the
    // secret is still there.
    const stored = storedRow()
    const ref = JSON.parse(String(stored.credential_ref)) as { version: number }
    expect(ref.version).toBe(1)
    expect(vault.entries.get(`host:host-1:${ref.version}:password`)).toBe(
      'old-password',
    )
  })
})

describe('a failed cleanup is reported, not thrown', () => {
  it('a save that committed still succeeds when retiring the old version fails', async () => {
    mocks.vaultRemoveVersion.mockRejectedValue(new Error('vault locked'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      updateHost('host-1', { password: PASSWORD }),
    ).resolves.toBeUndefined()

    // The new secret is in the vault and the row points at it; the leftover old
    // generation is waste, not a lost credential.
    expect(vault.entries.get('host:host-1:2:password')).toBe(PASSWORD)
    warn.mockRestore()
  })
})

describe('clear and delete', () => {
  it('clear stops the row pointing at the secret before removing it', async () => {
    const order: string[] = []
    mocks.executeQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('credential_ref = NULL')) order.push('update')
    })
    mocks.vaultRemoveVersion.mockImplementation(async () => {
      order.push('vault')
      return []
    })

    await updateHost('host-1', { clearCredential: true })

    expect(order).toEqual(['update', 'vault'])
  })

  it('a clear whose update fails leaves the credential in the vault', async () => {
    mocks.executeQuery.mockRejectedValue(new Error('database is locked'))

    await expect(
      updateHost('host-1', { clearCredential: true }),
    ).rejects.toThrow(/database is locked/)
    // Nothing was removed: the row still points at it, so it must still exist.
    expect(vault.entries.get('host:host-1:1:password')).toBe('old-password')
  })

  it('deleting a host removes exactly the version it pointed at', async () => {
    await deleteHost('host-1')
    expect(mocks.vaultRemoveVersion).toHaveBeenCalledWith(
      { type: 'host', id: 'host-1' },
      1,
      ['password'],
    )
  })

  it('deleting a host whose vault is locked still deletes the row', async () => {
    mocks.vaultRemoveVersion.mockRejectedValue(new Error('vault locked'))
    await expect(deleteHost('host-1')).resolves.toBeUndefined()
    expect(mocks.executeQuery).toHaveBeenCalledWith(
      'DELETE FROM hosts WHERE id = ?',
      ['host-1'],
    )
  })
})

describe('creating', () => {
  it('writes version 1 for a brand-new host', async () => {
    mocks.select.mockResolvedValue([])
    await createHost({
      id: 'host-new',
      name: 'new',
      hostname: 'new.example.test',
      port: 22,
      username: 'root',
      authType: 'password',
      isFavorite: false,
      portForwards: [],
      password: PASSWORD,
      createdAt: 0,
      updatedAt: 0,
    } as never)

    expect(vault.entries.get('host:host-new:1:password')).toBe(PASSWORD)
  })

  it('removes the vault entry when the insert fails', async () => {
    mocks.select.mockResolvedValue([])
    mocks.executeQuery.mockRejectedValue(new Error('UNIQUE constraint failed'))

    await expect(
      createHost({
        id: 'host-new',
        name: 'new',
        hostname: 'new.example.test',
        port: 22,
        username: 'root',
        authType: 'password',
        isFavorite: false,
        portForwards: [],
        password: PASSWORD,
        createdAt: 0,
        updatedAt: 0,
      } as never),
    ).rejects.toThrow(/UNIQUE/)

    expect(vault.entries.has('host:host-new:1:password')).toBe(false)
  })
})
