// The store must reflect the database after every write, because the very next
// thing the user does is connect.
//
// The defect this locks: `addHost` built its in-memory copy from the *form*, which
// carries no `credentialRef` — the reference is decided inside the write path. So
// "save, then connect" produced a host that reported "nothing stored" while the
// vault held the password, and the connection failed with an empty credential.
// Saving and then fixing it required a page reload.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  select: vi.fn(),
  executeQuery: vi.fn(),
  vaultWrite: vi.fn(),
  vaultRead: vi.fn(),
  vaultRemoveVersion: vi.fn(),
  resolveSessionCredential: vi.fn(),
}))

vi.mock('@/service/database/connection', () => ({
  executeQuery: mocks.executeQuery,
  select: mocks.select,
  selectStrict: mocks.select,
}))

vi.mock('@/service/vault-secret-provider', () => ({
  vaultSecretProvider: {
    write: mocks.vaultWrite,
    read: mocks.vaultRead,
    remove: vi.fn(async () => undefined),
    removeVersion: mocks.vaultRemoveVersion,
    isAvailable: vi.fn(async () => true),
    availability: vi.fn(async () => ({ ok: true })),
  },
}))

const { useHostStore } = await import('./host')

const PASSWORD = 'store-refresh-password'

/** A tiny in-memory table that the connection mock reads and writes. */
let rows: Map<string, Record<string, unknown>>

function installDatabase() {
  rows = new Map()
  mocks.executeQuery.mockImplementation(
    async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('INSERT INTO hosts')) {
        const id = String(params[0])
        rows.set(id, {
          id,
          name: params[1],
          hostname: params[2],
          port: params[3],
          username: params[4],
          auth_type: params[5],
          password: null,
          private_key: null,
          certificate: params[6],
          credential_ref: params[7],
          group_id: params[8],
          is_favorite: params[9],
          color: params[10],
          tags: params[11],
          port_forwards: params[12],
          startup_command: params[13],
          environment: params[14],
          jump_host_id: params[15],
          jump_host_auth_type: params[16],
          agent_forwarding: params[17],
          shell_integration: params[18],
          created_at: params[19],
          updated_at: params[20],
        })
        return undefined
      }
      if (sql.startsWith('DELETE FROM hosts')) {
        rows.delete(String(params[0]))
        return undefined
      }
      if (sql.startsWith('UPDATE hosts')) {
        const id = String(params[params.length - 1])
        const row = rows.get(id)
        if (!row) return undefined
        // Only the fields this test cares about; enough to prove the store must
        // read the row back rather than reuse the form.
        if (sql.includes('credential_ref = NULL')) {
          row.credential_ref = null
          row.password = null
          row.private_key = null
        } else if (sql.includes('COALESCE(?, credential_ref)')) {
          const newRef = params.find(
            (value, index) =>
              index > 0 &&
              typeof value === 'string' &&
              String(value).includes('"provider":"vault"'),
          )
          if (newRef) row.credential_ref = newRef
          if (sql.includes('CASE WHEN ? = 1')) {
            const marker = params[5]
            if (marker === 1) {
              row.password = null
              row.private_key = null
            }
          }
        }
        row.name = params[0]
        return undefined
      }
      return undefined
    },
  )
  mocks.select.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('WHERE id = ?')) {
      const row = rows.get(String(params[0]))
      return row ? [{ ...row }] : []
    }
    return [...rows.values()].map(row => ({ ...row }))
  })
}

function form(overrides: Record<string, unknown> = {}) {
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

beforeEach(() => {
  installDatabase()
  mocks.vaultWrite.mockReset().mockResolvedValue(undefined)
  // The latest write for a kind wins: a second save reads back its own value.
  mocks.vaultRead.mockReset().mockImplementation(
    async (_resource: unknown, _version: number, kind: string) => {
      const call = [...mocks.vaultWrite.mock.calls]
        .reverse()
        .find(([, , writtenKind]) => writtenKind === kind)
      return call?.[3] as string | undefined
    },
  )
  mocks.vaultRemoveVersion.mockReset().mockResolvedValue([])
  mocks.resolveSessionCredential.mockReset()
  useHostStore.setState({ hosts: [] })
})

describe('create → save → store → connect', () => {
  it('the store holds the reference the write path produced', async () => {
    const saved = await useHostStore
      .getState()
      .addHost(form({ password: PASSWORD }))

    expect(saved.credentialRef).toEqual({
      kinds: ['password'],
      provider: 'vault',
      version: 1,
    })
    // And the value itself is not in the store.
    expect(saved.password).toBeUndefined()
    expect(JSON.stringify(useHostStore.getState().hosts)).not.toContain(PASSWORD)
  })

  it('the saved host can connect without a reload', async () => {
    const saved = await useHostStore
      .getState()
      .addHost(form({ password: PASSWORD }))

    const { withResolvedCredential } = await import(
      '@/features/terminal/services/terminal-launcher'
    )
    const resolved = await withResolvedCredential(saved)
    // The reference is what makes the resolution reach the vault at all.
    expect(resolved.password).toBe(PASSWORD)
  })
})

describe('update → save → store', () => {
  it('a password change is visible immediately', async () => {
    const saved = await useHostStore.getState().addHost(form())
    // The first save stored nothing; give the host a credential now.
    await useHostStore.getState().updateHost(saved.id, { password: PASSWORD })

    const host = useHostStore.getState().hosts.find(h => h.id === saved.id)
    expect(host?.credentialRef).toEqual({
      kinds: ['password'],
      provider: 'vault',
      version: 1,
    })

    const { withResolvedCredential } = await import(
      '@/features/terminal/services/terminal-launcher'
    )
    expect((await withResolvedCredential(host!)).password).toBe(PASSWORD)
  })

  it('changing the credential again bumps the version in the store', async () => {
    const saved = await useHostStore
      .getState()
      .addHost(form({ password: PASSWORD }))
    await useHostStore
      .getState()
      .updateHost(saved.id, { password: 'second-password' })

    const host = useHostStore.getState().hosts.find(h => h.id === saved.id)
    expect(host?.credentialRef).toMatchObject({ version: 2 })
  })

  it('clearing the credential is visible immediately', async () => {
    const saved = await useHostStore
      .getState()
      .addHost(form({ password: PASSWORD }))
    await useHostStore.getState().updateHost(saved.id, { clearCredential: true })

    const host = useHostStore.getState().hosts.find(h => h.id === saved.id)
    expect(host?.credentialRef ?? null).toBeNull()
    expect(host?.password).toBeUndefined()

    // The next connect must not silently send an empty password for a host that
    // used to have one; with no reference it falls through to the agent/prompt
    // path, which is the correct behaviour for "no stored credential".
    const { withResolvedCredential } = await import(
      '@/features/terminal/services/terminal-launcher'
    )
    const resolved = await withResolvedCredential(host!)
    expect(resolved.password).toBeUndefined()
  })

  it('an unrelated edit keeps the reference in the store', async () => {
    const saved = await useHostStore
      .getState()
      .addHost(form({ password: PASSWORD }))
    await useHostStore.getState().updateHost(saved.id, { name: 'renamed' })

    const host = useHostStore.getState().hosts.find(h => h.id === saved.id)
    expect(host?.name).toBe('renamed')
    expect(host?.credentialRef).toMatchObject({ provider: 'vault' })
  })
})

describe('a save that fails leaves the store alone', () => {
  it('addHost does not add a host when the vault refuses', async () => {
    const provider = await import('@/service/vault-secret-provider')
    const spy = vi
      .spyOn(provider.vaultSecretProvider, 'availability')
      .mockResolvedValue({ ok: false, state: 'locked' })

    await expect(
      useHostStore.getState().addHost(form({ password: PASSWORD })),
    ).rejects.toThrow(/vault/i)
    expect(useHostStore.getState().hosts).toEqual([])
    spy.mockRestore()
  })
})
