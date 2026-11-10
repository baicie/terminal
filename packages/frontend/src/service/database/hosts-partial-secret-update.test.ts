// Phase 10.1.1 WP1 — a partial secret update must keep the half it did not mention.
//
// The defect this locks:
//
// `persistHostSecrets` builds the new reference from the object it is handed. When
// the dialog edits a host that stores *both* a password and a private key and the
// user retypes only the password, the object carries `privateKey: undefined` — the
// form starts empty for every secret field, because the values live in the vault
// and the columns are NULL. The new reference therefore lists `['password']`, and
// `retirePreviousVersion` then deletes the whole old generation, private key
// included. The host ends up with a new password and no key at all, and the key is
// unrecoverable.
//
// The ssh-key path solved the same problem (`persistKeySecrets` copies the
// un-retyped kinds forward). The host path never got the equivalent, because the
// only multi-secret host test writes *both* secrets at once.

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

const { updateHost } = await import('./hosts')

const OLD_PASSWORD = 'old-password'
const OLD_KEY =
  '-----BEGIN OPENSSH PRIVATE KEY-----\nold\n-----END OPENSSH PRIVATE KEY-----'
const OLD_PASSPHRASE = 'old-passphrase'
const NEW_PASSWORD = 'new-password-value'

/**
 * A vault that behaves like the real one.
 *
 * Two properties matter for these tests and both match `VaultSecretProvider`:
 * a write overwrites whatever is at that key, and a read of a key that was never
 * written returns undefined rather than throwing.
 */
class FakeVault {
  readonly entries = new Map<string, string>()

  key(resource: { type: string; id: string }, version: number, kind: string) {
    return `${resource.type}:${resource.id}:${version}:${kind}`
  }

  install() {
    mocks.vaultWrite.mockImplementation(
      async (
        resource: { type: string; id: string },
        version: number,
        kind: string,
        value: string,
      ) => {
        this.entries.set(this.key(resource, version, kind), value)
      },
    )
    mocks.vaultRead.mockImplementation(
      async (
        resource: { type: string; id: string },
        version: number,
        kind: string,
      ) => this.entries.get(this.key(resource, version, kind)),
    )
    mocks.vaultRemoveVersion.mockImplementation(
      async (
        resource: { type: string; id: string },
        version: number,
        kinds: string[],
      ) => {
        for (const kind of kinds) {
          this.entries.delete(this.key(resource, version, kind))
        }
        return []
      },
    )
  }

  /** Everything the vault holds for one resource, as `version:kind` -> value. */
  dump(id: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [key, value] of this.entries) {
      const prefix = `host:${id}:`
      if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value
    }
    return out
  }
}

/** A stored row whose reference names the given kinds at version 1. */
function storedRow(kinds: string[]) {
  return {
    id: 'host-1',
    name: 'prod',
    hostname: 'prod.example.test',
    port: 22,
    username: 'alice',
    auth_type: kinds.includes('privateKey') ? 'key' : 'password',
    // Phase 10.1 keeps both secret columns NULL; the form therefore starts empty.
    password: null,
    private_key: null,
    certificate: null,
    credential_ref: JSON.stringify({ kinds, provider: 'vault', version: 1 }),
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
}

/** The reference the UPDATE bound, which is what a later connection will read. */
function boundRef(): { kinds: string[]; provider: string; version: number } {
  const update = mocks.executeQuery.mock.calls.find(([sql]) =>
    String(sql).startsWith('UPDATE hosts'),
  )
  expect(update).toBeDefined()
  const raw = (update?.[1] as unknown[]).find(
    value => typeof value === 'string' && value.includes('"provider":"vault"'),
  )
  expect(raw).toBeDefined()
  return JSON.parse(String(raw))
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
})

describe('a host that stores both a password and a private key', () => {
  beforeEach(() => {
    mocks.select.mockResolvedValue([storedRow(['password', 'privateKey'])])
    vault.entries.set('host:host-1:1:password', OLD_PASSWORD)
    vault.entries.set('host:host-1:1:privateKey', OLD_KEY)
  })

  it('keeps the private key when only the password is retyped', async () => {
    // Exactly what the edit dialog submits: every secret field is empty because
    // the values live in the vault, and the user filled in only the password.
    await updateHost('host-1', { password: NEW_PASSWORD })

    const ref = boundRef()
    // The new generation must still list the private key.
    expect(ref.kinds.sort()).toEqual(['password', 'privateKey'])
    expect(ref.version).toBe(2)

    // And the value must actually be there under the new version — a reference
    // that claims a kind the vault does not hold is worse than no reference.
    expect(vault.entries.get('host:host-1:2:privateKey')).toBe(OLD_KEY)
    expect(vault.entries.get('host:host-1:2:password')).toBe(NEW_PASSWORD)

    // The old generation is gone, so the key had to be copied forward.
    expect(vault.entries.has('host:host-1:1:privateKey')).toBe(false)
    expect(vault.entries.has('host:host-1:1:password')).toBe(false)
  })

  it('keeps the password when only the private key is retyped', async () => {
    const newKey =
      '-----BEGIN OPENSSH PRIVATE KEY-----\nnew\n-----END OPENSSH PRIVATE KEY-----'
    await updateHost('host-1', { privateKey: newKey })

    const ref = boundRef()
    expect(ref.kinds.sort()).toEqual(['password', 'privateKey'])
    expect(vault.entries.get('host:host-1:2:password')).toBe(OLD_PASSWORD)
    expect(vault.entries.get('host:host-1:2:privateKey')).toBe(newKey)
  })

  it('does not leave the host claiming a secret the vault does not hold', async () => {
    await updateHost('host-1', { password: NEW_PASSWORD })

    // Every kind the stored reference names must resolve.
    const ref = boundRef()
    for (const kind of ref.kinds) {
      expect(vault.entries.get(`host:host-1:${ref.version}:${kind}`)).toBeDefined()
    }
  })
})

describe('a host that also stores a passphrase', () => {
  // `hosts` has no `passphrase` column — only `ssh_keys` does — so a row can only
  // carry that kind if an import put it there under a reference. The carry-forward
  // logic is kind-agnostic, so this asserts the rule rather than a UI path: a
  // kind the row points at survives an update that did not mention it.
  beforeEach(() => {
    mocks.select.mockResolvedValue([
      storedRow(['password', 'privateKey', 'passphrase']),
    ])
    vault.entries.set('host:host-1:1:password', OLD_PASSWORD)
    vault.entries.set('host:host-1:1:privateKey', OLD_KEY)
    vault.entries.set('host:host-1:1:passphrase', OLD_PASSPHRASE)
  })

  it('keeps the key and the passphrase when only the password is retyped', async () => {
    await updateHost('host-1', { password: NEW_PASSWORD })

    const ref = boundRef()
    expect(ref.kinds.sort()).toEqual(['passphrase', 'password', 'privateKey'])
    expect(vault.entries.get('host:host-1:2:privateKey')).toBe(OLD_KEY)
    expect(vault.entries.get('host:host-1:2:passphrase')).toBe(OLD_PASSPHRASE)
  })
})

describe('retiring the old generation never deletes a kind the new one needs', () => {
  it('the old version is only removed after every kept kind was copied', async () => {
    mocks.select.mockResolvedValue([storedRow(['password', 'privateKey'])])
    vault.entries.set('host:host-1:1:password', OLD_PASSWORD)
    vault.entries.set('host:host-1:1:privateKey', OLD_KEY)

    const order: string[] = []
    mocks.vaultRemoveVersion.mockImplementation(
      async (
        _resource: unknown,
        _version: number,
        kinds: string[],
      ) => {
        order.push(`retire:${kinds.sort().join(',')}`)
        for (const kind of kinds) {
          vault.entries.delete(`host:host-1:1:${kind}`)
        }
        return []
      },
    )

    await updateHost('host-1', { password: NEW_PASSWORD })

    // The private key must already be readable under version 2 when version 1 is
    // retired. If the copy happened after the retire, this would be undefined.
    expect(vault.entries.get('host:host-1:2:privateKey')).toBe(OLD_KEY)
    expect(order).toEqual(['retire:password,privateKey'])
  })
})

describe('the un-retyped half is never invented', () => {
  it('a reference that promises a kind the vault lacks fails the update', async () => {
    // The row claims a private key that is not in the vault. Carrying a hole
    // forward would produce a new version that promises the same secret and still
    // cannot deliver it; failing keeps the old generation and tells the user.
    mocks.select.mockResolvedValue([storedRow(['password', 'privateKey'])])
    vault.entries.set('host:host-1:1:password', OLD_PASSWORD)
    // no privateKey under version 1

    await expect(updateHost('host-1', { password: NEW_PASSWORD })).rejects.toThrow()

    // The old generation is untouched: the user can still retype both.
    expect(vault.entries.get('host:host-1:1:password')).toBe(OLD_PASSWORD)
    expect(
      mocks.executeQuery.mock.calls.some(([sql]) =>
        String(sql).startsWith('UPDATE hosts'),
      ),
    ).toBe(false)
    // And the attempt left nothing behind under the version it opened, so a retry
    // starts from a clean slate rather than accumulating unreachable ciphertext.
    expect(vault.entries.has('host:host-1:2:password')).toBe(false)
    expect(vault.entries.has('host:host-1:2:privateKey')).toBe(false)
  })
})
