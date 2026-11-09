// An SSH key's private material belongs in the vault, exactly like a host
// password. The key row keeps its identity and the public half.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  select: vi.fn(),
  vaultWrite: vi.fn(),
  vaultRemove: vi.fn(),
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
    read: vi.fn(),
    isAvailable: mocks.vaultAvailable,
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

    expect(mocks.vaultWrite).toHaveBeenCalledWith('key-1', 'privateKey', PRIVATE_KEY)
    expect(parameters()).not.toContain(PRIVATE_KEY)
    expect(JSON.stringify(parameters())).not.toContain('BEGIN OPENSSH')
    // The INSERT hard-codes NULL for both secret columns (private_key and
    // passphrase), which are not adjacent in the column list.
    expect(statementText()).toMatch(/VALUES \(\?, \?, \?, NULL, \?, \?, NULL,/)
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

    expect(mocks.vaultWrite).toHaveBeenCalledWith('key-1', 'passphrase', PASSPHRASE)
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
  it('routes a new private key to the vault', async () => {
    await updateSSHKey('key-1', { private_key: PRIVATE_KEY } as never)
    expect(mocks.vaultWrite).toHaveBeenCalledWith('key-1', 'privateKey', PRIVATE_KEY)
    expect(JSON.stringify(parameters())).not.toContain('BEGIN OPENSSH')
    expect(statementText()).toMatch(/private_key = NULL/)
  })

  it('routes a new passphrase to the vault', async () => {
    await updateSSHKey('key-1', { passphrase: PASSPHRASE } as never)
    expect(mocks.vaultWrite).toHaveBeenCalledWith('key-1', 'passphrase', PASSPHRASE)
    expect(JSON.stringify(parameters())).not.toContain(PASSPHRASE)
  })

  it('a rename does not touch stored secrets', async () => {
    await updateSSHKey('key-1', { name: 'renamed' } as never)
    expect(mocks.vaultWrite).not.toHaveBeenCalled()
    expect(statementText()).not.toMatch(/private_key|passphrase/)
  })
})
