// The write path the UI actually uses must not put a secret in SQLite.
//
// The Phase 10 unit tests covered `service/database/hosts.ts` directly and
// passed, while the real UI went through the store and kept writing plaintext.
// These tests call the *store* API for exactly that reason.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  select: vi.fn(),
  vaultWrite: vi.fn(),
  vaultRemove: vi.fn(),
  vaultAvailable: vi.fn(async () => true),
}))

vi.mock('@/service/database/connection', () => ({
  executeQuery: mocks.executeQuery,
  select: mocks.select,
  selectStrict: mocks.select,
}))

vi.mock('@/service/vault-secret-provider', () => ({
  vaultSecretProvider: {
    write: mocks.vaultWrite,
    remove: mocks.vaultRemove,
    read: vi.fn(),
    isAvailable: mocks.vaultAvailable,
    availability: async () =>
      (await mocks.vaultAvailable())
        ? { ok: true }
        : { ok: false, state: 'locked' },
  },
}))

const { useHostStore } = await import('./host')

const PASSWORD = 'ui-path-password-should-never-hit-sqlite'
const PRIVATE_KEY =
  '-----BEGIN OPENSSH PRIVATE KEY-----\nui-path-key\n-----END OPENSSH PRIVATE KEY-----'

function baseForm(overrides: Record<string, unknown> = {}) {
  return {
    name: 'prod',
    hostname: 'prod.example.test',
    port: 22,
    username: 'alice',
    authType: 'password' as const,
    isFavorite: false,
    portForwards: [],
    ...overrides,
  }
}

/** Every SQL string and parameter list the store issued during one call. */
function issuedStatements(): Array<{ sql: string; params: unknown[] }> {
  return mocks.executeQuery.mock.calls.map(([sql, params]) => ({
    sql: String(sql),
    params: (params as unknown[]) ?? [],
  }))
}

function allParamsText(): string {
  return JSON.stringify(issuedStatements().map(statement => statement.params))
}

beforeEach(() => {
  mocks.executeQuery.mockReset()
  mocks.select.mockReset()
  mocks.vaultWrite.mockReset()
  mocks.vaultRemove.mockReset()
  mocks.vaultWrite.mockResolvedValue(undefined)
  mocks.vaultRemove.mockResolvedValue(undefined)
  mocks.vaultAvailable.mockResolvedValue(true)
  mocks.select.mockResolvedValue([])
  useHostStore.setState({ hosts: [] })
})

/**
 * Makes the row `updateHost` reads back exist.
 *
 * `updateHost` merges onto the stored row so a partial update cannot blank
 * columns it never mentioned; these tests therefore need the row they update to
 * be readable. The returned row is what the previous assertions already assume.
 */
function seedStoredRow(id: string, overrides: Record<string, unknown> = {}) {
  mocks.select.mockResolvedValue([
    {
      id,
      name: 'prod',
      hostname: 'prod.example.test',
      port: 22,
      username: 'alice',
      auth_type: 'password',
      password: null,
      private_key: null,
      certificate: null,
      credential_ref: null,
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
    },
  ])
}

describe('the UI write path never puts a secret in SQLite', () => {
  it('addHost writes the password to the vault, not to a column', async () => {
    await useHostStore.getState().addHost(baseForm({ password: PASSWORD }))

    expect(mocks.vaultWrite).toHaveBeenCalledWith(
      expect.any(String),
      'password',
      PASSWORD,
    )
    const text = allParamsText()
    expect(text).not.toContain(PASSWORD)
    // The INSERT must not name the secret columns with a bound value.
    const insert = issuedStatements().find(statement =>
      statement.sql.startsWith('INSERT INTO hosts'),
    )
    expect(insert).toBeDefined()
    expect(insert?.sql).toMatch(/NULL, NULL/)
  })

  it('addHost writes a private key to the vault, not to a column', async () => {
    await useHostStore
      .getState()
      .addHost(baseForm({ authType: 'key', privateKey: PRIVATE_KEY }))

    expect(mocks.vaultWrite).toHaveBeenCalledWith(
      expect.any(String),
      'privateKey',
      PRIVATE_KEY,
    )
    expect(allParamsText()).not.toContain('BEGIN OPENSSH')
  })

  it('updateHost with a new password keeps it out of SQLite', async () => {
    const created = await useHostStore.getState().addHost(baseForm())
    seedStoredRow(created.id)
    mocks.executeQuery.mockClear()

    await useHostStore.getState().updateHost(created.id, { password: PASSWORD })

    expect(mocks.vaultWrite).toHaveBeenCalledWith(
      created.id,
      'password',
      PASSWORD,
    )
    expect(allParamsText()).not.toContain(PASSWORD)
    const update = issuedStatements().find(statement =>
      statement.sql.startsWith('UPDATE hosts'),
    )
    // The columns are blanked behind a marker that is 1 because this call is the
    // one carrying the secret.
    expect(update?.sql).toMatch(
      /password = CASE WHEN \? = 1 THEN NULL ELSE password END/,
    )
    expect(update?.params.slice(5, 7)).toEqual([1, 1])
  })

  it('an edit that carries no secret does not touch the vault', async () => {
    const created = await useHostStore.getState().addHost(baseForm())
    seedStoredRow(created.id)
    mocks.vaultWrite.mockClear()
    mocks.executeQuery.mockClear()

    await useHostStore.getState().updateHost(created.id, { name: 'renamed' })

    expect(mocks.vaultWrite).not.toHaveBeenCalled()
    // The reference must survive an unrelated edit: the CASE marker says "keep"
    // and the second placeholder is NULL, so COALESCE falls back to the column.
    const update = issuedStatements().find(statement =>
      statement.sql.startsWith('UPDATE hosts'),
    )
    expect(update?.sql).toMatch(/CASE WHEN \? = '' THEN NULL ELSE COALESCE/)
    expect(update?.params).toContain('keep')
  })

  it('clearing a credential deletes it from the vault explicitly', async () => {
    const created = await useHostStore
      .getState()
      .addHost(baseForm({ password: PASSWORD }))
    seedStoredRow(created.id)
    mocks.vaultWrite.mockClear()
    mocks.vaultRemove.mockClear()
    mocks.executeQuery.mockClear()

    await useHostStore
      .getState()
      .updateHost(created.id, { clearCredential: true })

    expect(mocks.vaultRemove).toHaveBeenCalledWith(created.id, 'password')
    const update = issuedStatements().find(statement =>
      statement.sql.startsWith('UPDATE hosts'),
    )
    // An explicit clear sets the reference to NULL rather than preserving it.
    expect(update?.sql).toMatch(/CASE WHEN \? = '' THEN NULL ELSE COALESCE/)
    expect(update?.params).toContain('')
  })

  it('refuses to save when the vault cannot accept the secret', async () => {
    mocks.vaultAvailable.mockResolvedValue(false)

    await expect(
      useHostStore.getState().addHost(baseForm({ password: PASSWORD })),
    ).rejects.toThrow(/vault/i)

    // Nothing reached SQLite: a failed save must not leave a half-written row.
    expect(
      issuedStatements().some(statement =>
        statement.sql.startsWith('INSERT INTO hosts'),
      ),
    ).toBe(false)
  })
})

describe('legacy rows stay usable until the migration runs', () => {
  it('reads a pre-migration plaintext secret so the host still connects', async () => {
    // Ignoring these would leave every host saved by an older build unable to
    // connect, which is worse than the plaintext it would remove. The boundary is
    // the write path; the read path stays compatible until migration clears them.
    mocks.select.mockResolvedValue([
      {
        id: 'legacy-1',
        name: 'legacy',
        hostname: 'legacy.example.test',
        port: 22,
        username: 'alice',
        auth_type: 'password',
        password: 'legacy-plaintext',
        private_key: null,
        certificate: null,
        credential_ref: null,
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
      },
    ])
    await useHostStore.getState().loadHosts()
    const host = useHostStore.getState().hosts[0]
    expect(host.password).toBe('legacy-plaintext')
    expect(host.credentialRef).toBeNull()
  })
})

describe('the store does not keep secrets in memory after a reload', () => {
  it('getHosts returns metadata and a reference, never a plaintext secret', async () => {
    mocks.select.mockResolvedValue([
      {
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
      },
    ])

    await useHostStore.getState().loadHosts()

    const host = useHostStore.getState().hosts[0]
    expect(host.password).toBeUndefined()
    expect(host.privateKey).toBeUndefined()
    expect(host.credentialRef).toEqual({
      kinds: ['password'],
      provider: 'vault',
    })
  })
})
