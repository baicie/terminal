// Phase 10.3 — switching authentication method must not keep the old secret.
//
// The carry-forward added in Phase 10.1.1 solved a real problem: an edit dialog
// starts empty (secrets live in the vault), so a password-only change over a host
// that also stores a key must not drop the key. It unions `supplied` with
// `current.kinds`.
//
// That union is wrong for a different intent: the user switching authType from
// `key` to `agent` is saying "stop using a credential". The write path cannot see
// the difference — it is not told the auth type — so it carries the old key into
// the new generation, and the row keeps a credential the user asked to stop using.
//
// It is worse in the password→key direction: the old account password is carried
// into the same generation as the new private key, and the SSH layer is handed
// both, using the password as the key's passphrase.

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

const OLD_PASSWORD = 'old-account-password'
const NEW_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nnew\n-----END OPENSSH PRIVATE KEY-----'

/** A vault that stores what it is given, like the real one. */
class FakeVault {
  readonly entries = new Map<string, string>()

  private key(resource: { type: string; id: string }, version: number, kind: string) {
    return version === 0
      ? `${resource.type}:${resource.id}:${kind}`
      : `${resource.type}:${resource.id}:${version}:${kind}`
  }

  install() {
    mocks.vaultWrite.mockImplementation(
      async (r: { type: string; id: string }, v: number, k: string, value: string) => {
        this.entries.set(this.key(r, v, k), value)
      },
    )
    mocks.vaultRead.mockImplementation(
      async (r: { type: string; id: string }, v: number, k: string) =>
        this.entries.get(this.key(r, v, k)),
    )
    mocks.vaultRemoveVersion.mockImplementation(
      async (r: { type: string; id: string }, v: number, kinds: string[]) => {
        for (const kind of kinds) this.entries.delete(this.key(r, v, kind))
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
    username: 'deploy',
    auth_type: 'password',
    password: null,
    private_key: null,
    certificate: null,
    credential_ref: JSON.stringify({
      kinds: ['password'],
      provider: 'vault',
      version: 1,
    }),
    identity_file_path: null,
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

function boundRef(): { kinds: string[]; provider: string; version: number } {
  const call = mocks.executeQuery.mock.calls.find(([sql]) =>
    String(sql).startsWith('UPDATE hosts'),
  )
  const raw = (call?.[1] as unknown[]).find(
    v => typeof v === 'string' && String(v).includes('"provider":"vault"'),
  )
  return JSON.parse(String(raw))
}

let vault: FakeVault

beforeEach(() => {
  vi.clearAllMocks()
  mocks.executeQuery.mockResolvedValue(undefined)
  mocks.select.mockResolvedValue([storedRow()])
  mocks.availability.mockResolvedValue({ ok: true })
  vault = new FakeVault()
  vault.install()
  vault.entries.set('host:host-1:1:password', OLD_PASSWORD)
})

describe('switching to agent means "stop storing a credential"', () => {
  it('drops the stored password instead of carrying it into a new version', async () => {
    // The dialog submits the whole form; switching to agent clears the secret
    // fields, so `hasSecrets` is false and the row must stop pointing at one.
    await updateHost('host-1', { authType: 'agent' })

    // Nothing should have been written under a new version.
    expect(mocks.vaultWrite).not.toHaveBeenCalled()
    // And the row must no longer claim to hold a password.
    const call = mocks.executeQuery.mock.calls.find(([sql]) =>
      String(sql).startsWith('UPDATE hosts'),
    )
    const params = call?.[1] as unknown[]
    const refArg = params.find(
      v => typeof v === 'string' && String(v).includes('"provider":"vault"'),
    )
    // COALESCE keeps the old reference when null is bound — so the only correct
    // outcome is that the statement itself clears it.
    const sql = String(call?.[0])
    expect(refArg === undefined || refArg === null || sql.includes('credential_ref = NULL')).toBe(true)
  })
})

describe('switching from password to key does not merge the two', () => {
  it('the new generation holds the key, not the old account password', async () => {
    await updateHost('host-1', { authType: 'key', privateKey: NEW_KEY })

    const ref = boundRef()
    // The old password was for a different auth method. Carrying it forward puts
    // it in the same generation as the key, where the SSH layer treats it as the
    // key's passphrase.
    expect(ref.kinds).toEqual(['privateKey'])
    expect(vault.entries.get(`host:host-1:${ref.version}:password`)).toBeUndefined()
    expect(vault.entries.get(`host:host-1:${ref.version}:privateKey`)).toBe(NEW_KEY)
  })
})
