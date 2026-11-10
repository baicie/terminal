// An SSH key's private material belongs in the vault, exactly like a host
// password. The key row keeps its identity and the public half.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  select: vi.fn(),
  vaultWrite: vi.fn(),
  vaultRemove: vi.fn(),
  vaultRead: vi.fn(),
  vaultRemoveVersion: vi.fn(),
  vaultAvailable: vi.fn(async () => true),
}))

vi.mock('./connection', () => ({
  executeQuery: mocks.executeQuery,
  select: mocks.select,
}))

vi.mock('@/service/vault-secret-provider', () => ({
  vaultSecretProvider: {
    write: mocks.vaultWrite,
    remove: mocks.vaultRemove,
    read: mocks.vaultRead,
    removeVersion: mocks.vaultRemoveVersion,
    isAvailable: mocks.vaultAvailable,
    // The save path now asks why the vault is unavailable so it can name the
    // right next step; this stub reports an existing, locked vault.
    availability: vi.fn(async () => {
      const ok = await mocks.vaultAvailable()
      return ok ? { ok: true } : { ok: false, state: 'locked' }
    }),
  },
}))

const { createSSHKey, updateSSHKey } = await import('./ssh-keys')

const PRIVATE_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nkey-material\n-----END OPENSSH PRIVATE KEY-----'
const PASSPHRASE = 'key-passphrase-secret'

function statementText(): string {
  return String((mocks.executeQuery.mock.calls[0] as [string])[0])
}

function parameters(): unknown[] {
  return ((mocks.executeQuery.mock.calls[0] as [string, unknown[]])[1]) ?? []
}

beforeEach(() => {
  mocks.executeQuery.mockReset()
  mocks.select.mockReset()
  mocks.vaultWrite.mockReset()
  mocks.vaultRemove.mockReset()
  mocks.vaultWrite.mockResolvedValue(undefined)
  mocks.vaultRemove.mockResolvedValue(undefined)
  mocks.vaultRemoveVersion.mockReset()
  mocks.vaultRemoveVersion.mockResolvedValue([])
  mocks.vaultRead.mockReset()
  // Every write is read back before the reference is produced.
  mocks.vaultRead.mockImplementation(
    async (_resource: unknown, _version: number, kind: string) => {
      const call = mocks.vaultWrite.mock.calls.find(
        ([, , writtenKind]) => writtenKind === kind,
      )
      return call?.[3] as string | undefined
    },
  )
  // `updateSSHKey` reads the stored row before deciding the next version.
  mocks.select.mockResolvedValue([
    {
      id: 'key-1',
      name: 'deploy',
      key_type: 'ssh-ed25519',
      private_key: null,
      public_key: null,
      certificate: null,
      passphrase: null,
      credential_ref: JSON.stringify({
        kinds: ['privateKey'],
        provider: 'vault',
        version: 1,
      }),
      is_encrypted: 1,
      created_at: 0,
      updated_at: 0,
    },
  ])
  mocks.vaultAvailable.mockResolvedValue(true)
})

describe('createSSHKey', () => {
  it('writes the private key to the vault, not the row', async () => {
    await createSSHKey({
      id: 'key-1',
      name: 'deploy',
      key_type: 'ssh-ed25519',
      private_key: PRIVATE_KEY,
      public_key: 'ssh-ed25519 AAAA',
      certificate: null,
      passphrase: null,
      is_encrypted: 0,
    } as never)

    expect(mocks.vaultWrite).toHaveBeenCalledWith(
      { type: 'ssh-key', id: 'key-1' },
      1,
      'privateKey',
      PRIVATE_KEY,
    )
    expect(parameters()).not.toContain(PRIVATE_KEY)
    expect(JSON.stringify(parameters())).not.toContain('BEGIN OPENSSH')
    // The INSERT hard-codes NULL for both secret columns (private_key and
    // passphrase), which are not adjacent in the column list.
    // The INSERT hard-codes NULL for both secret columns and carries the
    // reference instead.
    expect(statementText()).toMatch(
      /VALUES \(\?, \?, \?, NULL, \?, \?, NULL, \?, \?, \?, \?\)/,
    )
  })

  it('writes a passphrase to the vault', async () => {
    await createSSHKey({
      id: 'key-1',
      name: 'deploy',
      key_type: 'ssh-rsa',
      private_key: PRIVATE_KEY,
      public_key: null,
      certificate: null,
      passphrase: PASSPHRASE,
      is_encrypted: 1,
    } as never)

    expect(mocks.vaultWrite).toHaveBeenCalledWith(
      { type: 'ssh-key', id: 'key-1' },
      expect.any(Number),
      'passphrase',
      PASSPHRASE,
    )
    expect(JSON.stringify(parameters())).not.toContain(PASSPHRASE)
  })

  it('saves a public-only key without touching the vault', async () => {
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
  })

  it('refuses to save when the vault is locked', async () => {
    mocks.vaultAvailable.mockResolvedValue(false)
    await expect(
      createSSHKey({
        id: 'key-1',
        name: 'deploy',
        key_type: 'ssh-ed25519',
        private_key: PRIVATE_KEY,
        public_key: null,
        certificate: null,
        passphrase: null,
        is_encrypted: 0,
      } as never),
    ).rejects.toThrow(/vault/i)
    expect(mocks.executeQuery).not.toHaveBeenCalled()
  })
})

describe('updateSSHKey', () => {
  it('routes a new private key to the vault under a new version', async () => {
    await updateSSHKey('key-1', { private_key: PRIVATE_KEY } as never)
    // The row already points at version 1, so the new value must not overwrite it:
    // a failure after this write has to leave the old key usable.
    expect(mocks.vaultWrite).toHaveBeenCalledWith(
      { type: 'ssh-key', id: 'key-1' },
      2,
      'privateKey',
      PRIVATE_KEY,
    )
    expect(JSON.stringify(parameters())).not.toContain('BEGIN OPENSSH')
    // The column is blanked only behind a marker that says this call carries the
    // secret, so an unrelated edit cannot destroy a pre-migration plaintext.
    expect(statementText()).toMatch(
      /private_key = CASE WHEN \? = 1 THEN NULL ELSE private_key END/,
    )
    expect(parameters()[2]).toBe(1)
  })

  it('routes a new passphrase to the vault', async () => {
    // The row's reference names both kinds, so the un-retyped private key has to be
    // present in the old generation for the update to carry it forward.
    mocks.vaultRead.mockImplementation(
      async (_resource: unknown, _version: number, kind: string) => {
        const call = [...mocks.vaultWrite.mock.calls]
          .reverse()
          .find(([, , writtenKind]) => writtenKind === kind)
        if (call) return call[3] as string
        // The existing private key, read from version 1.
        return kind === 'privateKey' ? 'existing-private-key' : undefined
      },
    )
    await updateSSHKey('key-1', { passphrase: PASSPHRASE } as never)
    expect(mocks.vaultWrite).toHaveBeenCalledWith(
      { type: 'ssh-key', id: 'key-1' },
      expect.any(Number),
      'passphrase',
      PASSPHRASE,
    )
    expect(JSON.stringify(parameters())).not.toContain(PASSPHRASE)
  })

  it('a rename does not touch stored secrets', async () => {
    await updateSSHKey('key-1', { name: 'renamed' } as never)
    expect(mocks.vaultWrite).not.toHaveBeenCalled()
    // The statement mentions the columns (their CASE marker is always present) but
    // the marker is 0, so the stored values survive.
    const params = parameters()
    expect(params[2]).toBe(0)
    expect(params[5]).toBe(0)
    expect(params).not.toContainEqual(
      expect.stringContaining('"provider":"vault"'),
    )
  })
})
