// Phase 10.3 WP1 — binding an imported IdentityFile to a real credential.
//
// The state after an OpenSSH import:
//
//   the row has  identityFilePath = '~/.ssh/id_ed25519'
//   the row has  credentialRef    = null
//
// `resolveSessionCredential` correctly refuses to connect in that state — the app
// must not read arbitrary files during a connection attempt. But nothing in the UI
// could clear the path either, so the host was permanently unconnectable: typing a
// key into the edit dialog stored a vault reference, and the stale path still
// blocked the connection ahead of it.
//
// Two defects, both locked here:
//
//   1. saving a real credential must retire the path — otherwise a host that now
//      holds a perfectly good vault credential is still refused;
//   2. the form must show the path and let the user act on it, rather than
//      presenting a host that looks configured and cannot connect.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  select: vi.fn(),
  vaultWrite: vi.fn(),
  vaultRead: vi.fn(),
  vaultRemove: vi.fn(),
  vaultRemoveVersion: vi.fn(),
  availability: vi.fn(),
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
    availability: mocks.availability,
  },
}))

const { updateHost } = await import('./hosts')

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'host-1',
    name: 'imported',
    hostname: 'imported.example.test',
    port: 22,
    username: 'deploy',
    auth_type: 'key',
    password: null,
    private_key: null,
    certificate: null,
    credential_ref: null,
    identity_file_path: '~/.ssh/id_ed25519',
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

/**
 * Whether the row will still carry a key path after this statement.
 *
 * Two shapes reach the database: the clear statement writes
 * `identity_file_path = NULL` in its SQL text and binds no value, while the normal
 * statement binds whatever the merged row holds. Both mean the same thing to a
 * reader, so this collapses them instead of asserting on argument positions that
 * differ between the two.
 */
function identityPathAfterUpdate(): unknown {
  const call = mocks.executeQuery.mock.calls.find(([sql]) =>
    String(sql).startsWith('UPDATE hosts'),
  )
  expect(call).toBeDefined()
  const [sql, rawParams] = call as [string, unknown[]]
  if (/identity_file_path = NULL/.test(sql)) return null
  const params = rawParams as unknown[]
  // Normal statement: ..., shell_integration, identity_file_path, updated_at, id
  return params[params.length - 3]
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.executeQuery.mockResolvedValue(undefined)
  mocks.select.mockResolvedValue([storedRow()])
  mocks.availability.mockResolvedValue({ ok: true })
  mocks.vaultWrite.mockResolvedValue(undefined)
  mocks.vaultRead.mockImplementation(
    async (
      _resource: unknown,
      _version: number,
      kind: string,
    ) => {
      const call = mocks.vaultWrite.mock.calls.find(
        ([, , writtenKind]) => writtenKind === kind,
      )
      return call?.[3] as string | undefined
    },
  )
  mocks.vaultRemove.mockResolvedValue(undefined)
  mocks.vaultRemoveVersion.mockResolvedValue([])
})

const NEW_KEY =
  '-----BEGIN OPENSSH PRIVATE KEY-----\nbound\n-----END OPENSSH PRIVATE KEY-----'

describe('binding a credential to a host that carries a key path', () => {
  it('clears the stale path so the new credential is not blocked', async () => {
    await updateHost('host-1', { privateKey: NEW_KEY })


    // The path must be gone: `resolveSessionCredential` refuses on it before it
    // ever looks at the reference, so keeping it would make the save pointless.
    expect(identityPathAfterUpdate()).toBeNull()
  })

  it('writes the key to the vault under a new generation', async () => {
    await updateHost('host-1', { privateKey: NEW_KEY })

    expect(mocks.vaultWrite).toHaveBeenCalled()
    const ref = mocks.executeQuery.mock.calls
      .find(([sql]) => String(sql).startsWith('UPDATE hosts'))?.[1]
      .find(
        (v: unknown) =>
          typeof v === 'string' && String(v).includes('"provider":"vault"'),
      )
    expect(ref).toBeDefined()
    const parsed = JSON.parse(String(ref)) as { kinds: string[] }
    expect(parsed.kinds).toContain('privateKey')
  })

  it('keeps the path when the update carries no credential', async () => {
    // Renaming an imported host must not silently drop the reference to the file
    // it was set up with.
    await updateHost('host-1', { name: 'renamed' })
    expect(identityPathAfterUpdate()).toBe('~/.ssh/id_ed25519')
  })

  it('an explicit clear removes the path too', async () => {
    await updateHost('host-1', { clearCredential: true })
    expect(identityPathAfterUpdate()).toBeNull()
  })
})
