// Phase 10.3 WP0 — two chains that looked wired and were not.
//
// Both defects share a shape that has bitten this codebase before: a guard exists,
// is tested in isolation, and the real entry point returns before reaching it.
//
// 1. `withResolvedCredential` returns the host unchanged when the reference is
//    null — seven lines before it would call the resolver that holds the
//    `identityFilePath` guard. So an imported host with a key path was neither
//    rejected nor connected-with-a-key: the guard never ran, and the launcher went
//    on to start a session with an empty key.
//
// 2. `addHost` mints a fresh uuid and ignores the id it is handed. The import
//    planner derives `jumpHostId` from the *planned* id, so every imported
//    ProxyJump pointed at an id no row would ever have.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  createHostRow: vi.fn(),
  getHostById: vi.fn(),
}))

vi.mock('@/service/database', () => ({
  createHost: mocks.createHostRow,
  getHostById: mocks.getHostById,
}))

vi.mock('@/service/database/hosts', () => ({
  createHost: mocks.createHostRow,
  getHostById: mocks.getHostById,
}))

vi.mock('@/service/database/connection', () => ({
  select: vi.fn(async () => []),
  selectStrict: vi.fn(async () => []),
  executeQuery: vi.fn(async () => undefined),
}))

vi.mock('@/service/vault-secret-provider', () => ({
  vaultSecretProvider: {
    availability: vi.fn(async () => ({ ok: true })),
    read: vi.fn(async () => undefined),
    write: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    removeVersion: vi.fn(async () => []),
    isAvailable: vi.fn(async () => true),
  },
}))

const { withResolvedCredential } = await import(
  '@/features/terminal/services/terminal-launcher'
)

function importedHost(overrides: Partial<Host> = {}): Host {
  return {
    id: 'h-1',
    name: 'db',
    hostname: 'db.internal',
    port: 22,
    username: 'deploy',
    authType: 'key',
    credentialRef: null,
    identityFilePath: '~/.ssh/id_ed25519',
    isFavorite: false,
    portForwards: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as unknown as Host
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolve.mockReset()
})

describe('a host that carries an imported key path is not silently launched', () => {
  it('refuses instead of returning the host unchanged', async () => {
    // The row has no credentialRef (nothing was bound yet) but does have a path.
    // Returning it unchanged sends the launcher on to start a session with an
    // empty private key, which fails somewhere unrelated to the real cause.
    await expect(withResolvedCredential(importedHost())).rejects.toThrow(
      /id_ed25519|key file|binding/i,
    )
  })

  it('still returns a completely unconfigured host unchanged', async () => {
    // The same early return is correct for a host that stores nothing at all —
    // agent auth, or a password asked at connect time. Loosening that would break
    // every one of those.
    const plain = importedHost({ identityFilePath: undefined })
    await expect(withResolvedCredential(plain)).resolves.toBe(plain)
  })

  it('a host with a real credential reference goes through the resolver', async () => {
    // The provider mock returns a password for any read, which is what the real
    // resolver consumes. Asserting the resolved value proves the call path is
    // taken rather than the host being returned unchanged.
    const provider = await import('@/service/vault-secret-provider')
    vi.mocked(provider.vaultSecretProvider.read).mockResolvedValue('from-vault')

    const host = importedHost({
      credentialRef: { kinds: ['password'], provider: 'vault', version: 2 },
      identityFilePath: undefined,
    })
    const result = await withResolvedCredential(host)
    expect(result.password).toBe('from-vault')
  })
})
