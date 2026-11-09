// The vault reports failures as `{ type: 'key_not_found', message }`. Reading the
// wrong property made "this key was never stored" look like a real vault failure:
// removing a credential threw on the first kind the host did not have, which
// aborted the whole update.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  isUnlocked: vi.fn(async () => true),
}))

vi.mock('./vault', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('./vault')
  return {
    ...actual,
    vaultService: {
      get: mocks.get,
      set: mocks.set,
      delete: mocks.delete,
      isUnlocked: mocks.isUnlocked,
    },
  }
})

const { VaultSecretProvider } = await import('./vault-secret-provider')

/** Exactly what the Rust command layer serialises. */
function commandError(type: string, message = type): Error {
  return Object.assign(new Error(message), { type, message })
}

const RESOURCE = { type: 'host' as const, id: 'h1' }

let provider: InstanceType<typeof VaultSecretProvider>

beforeEach(() => {
  vi.clearAllMocks()
  provider = new VaultSecretProvider()
})

describe('a missing key is absence, not a failure', () => {
  it('read returns undefined for key_not_found', async () => {
    mocks.get.mockRejectedValue(commandError('key_not_found'))
    await expect(provider.read(RESOURCE, 1, 'password')).resolves.toBeUndefined()
  })

  it('read rethrows a locked vault', async () => {
    mocks.get.mockRejectedValue(commandError('vault_locked', 'vault is locked'))
    await expect(provider.read(RESOURCE, 1, 'password')).rejects.toThrow()
  })

  it('read rethrows a decryption failure', async () => {
    mocks.get.mockRejectedValue(commandError('decrypt_failed'))
    await expect(provider.read(RESOURCE, 1, 'password')).rejects.toThrow()
  })

  it('remove absorbs key_not_found so clearing an absent kind is not an error', async () => {
    mocks.delete.mockRejectedValue(commandError('key_not_found'))
    await expect(provider.remove(RESOURCE, 1, 'passphrase')).resolves.toBeUndefined()
  })

  it('remove rethrows a real failure', async () => {
    mocks.delete.mockRejectedValue(commandError('vault_locked'))
    await expect(provider.remove(RESOURCE, 1, 'password')).rejects.toThrow()
  })
})

describe('key naming', () => {
  it('namespaces by host and kind', async () => {
    mocks.set.mockResolvedValue(undefined)
    await provider.write(RESOURCE, 1, 'privateKey', 'k')
    expect(mocks.set).toHaveBeenCalledWith('host:h1:1:privateKey', 'k')
  })

  it('a read for one kind cannot reach another kind', async () => {
    mocks.get.mockResolvedValue('secret')
    await provider.read(RESOURCE, 1, 'password')
    expect(mocks.get).toHaveBeenCalledWith('host:h1:1:password')
  })
})
