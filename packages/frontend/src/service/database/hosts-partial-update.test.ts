// A partial update must not erase the columns it does not mention.
//
// `toggleFavorite` sends `{ isFavorite }` and nothing else. The first version of
// the Phase 10 write path bound `updates.name` straight into the statement, so
// the row was rewritten with NULL in every required column — SQLite rejected it,
// and the star never moved. Had the constraint been absent, the same statement
// would have silently destroyed a pre-migration plaintext credential, because it
// sets `password = NULL` whether or not the caller supplied a secret.

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
  // The real mapper turns snake_case columns into the `Host` shape. The test row
  // is written the way the mapper emits it, so this identity stand-in is honest.
  hostRowToHost: (row: { auth_type?: string } & Record<string, unknown>) => ({
    ...row,
    authType: row.auth_type,
  }),
}))

const { updateHost, deleteHost } = await import('./hosts')

const EXISTING_ROW = {
  id: 'host-1',
  name: 'prod',
  hostname: 'prod.example.test',
  port: 22,
  username: 'alice',
  auth_type: 'password',
  password: 'legacy-plaintext',
  private_key: null,
  certificate: null,
  credential_ref: null,
  group_id: 'g1',
  is_favorite: 0,
  color: '#fff',
  tags: '["web"]',
  port_forwards: '[{"type":"local"}]',
  startup_command: 'tmux',
  environment: null,
  jump_host_id: null,
  jump_host_auth_type: null,
  agent_forwarding: 0,
  shell_integration: 'on',
  created_at: 1,
  updated_at: 2,
}

function lastStatement(): { sql: string; params: unknown[] } {
  const calls = mocks.executeQuery.mock.calls
  const [sql, params] = calls[calls.length - 1] as [string, unknown[]]
  return { sql, params }
}

beforeEach(() => {
  vi.clearAllMocks()
  // `updateHost` reads the current row so it can merge.
  mocks.select.mockResolvedValue([EXISTING_ROW])
  mocks.vaultRemove.mockResolvedValue(undefined)
  mocks.vaultRemoveVersion.mockResolvedValue([])
  mocks.vaultRead.mockImplementation(
    async (_resource: unknown, _version: number, kind: string) => {
      const call = mocks.vaultWrite.mock.calls.find(
        ([, , writtenKind]) => writtenKind === kind,
      )
      return call?.[3] as string | undefined
    },
  )
})

describe('a partial update keeps the fields it did not mention', () => {
  it('favourite toggle keeps name, hostname, port and username', async () => {
    await updateHost('host-1', { isFavorite: true })

    const { params } = lastStatement()
    expect(params[0]).toBe('prod')
    expect(params[1]).toBe('prod.example.test')
    expect(params[2]).toBe(22)
    expect(params[3]).toBe('alice')
    expect(params[4]).toBe('password')
  })

  it('favourite toggle no longer binds undefined into a NOT NULL column', async () => {
    await updateHost('host-1', { isFavorite: true })
    const { params } = lastStatement()
    // The first five bindings are the required identity columns.
    expect(params.slice(0, 5)).not.toContain(undefined)
    expect(params.slice(0, 5)).not.toContain(null)
  })

  it('a rename keeps the favourite flag it was not told about', async () => {
    await updateHost('host-1', { name: 'renamed' })
    const { params } = lastStatement()
    expect(params[0]).toBe('renamed')
    // is_favorite is derived from the merged row, so it stays 0 rather than null.
    expect(params).toContain(0)
  })
})

describe('a partial update does not destroy a legacy plaintext credential', () => {
  it('leaves password untouched when the update carries no secret', async () => {
    await updateHost('host-1', { isFavorite: true })

    const { sql } = lastStatement()
    // The statement must not unconditionally blank the column. It is allowed to
    // null it only behind a marker that says "the caller asked to".
    expect(sql).not.toMatch(/password\s*=\s*NULL\s*,/)
    expect(sql).toMatch(/password\s*=\s*CASE WHEN/)
  })

  it('clears the column only when the caller asked to clear', async () => {
    await updateHost('host-1', { clearCredential: true })
    const { sql } = lastStatement()
    // Clearing is its own statement, written so the row stops pointing at the
    // credential *before* anything is removed from the vault. A CASE marker shared
    // with the set-a-new-secret path was how "clear" and "keep" could be confused.
    expect(sql).toMatch(/password = NULL/)
    expect(sql).toMatch(/credential_ref = NULL/)
  })

  it('a clear writes no vault entry, only removes one', async () => {
    await updateHost('host-1', { clearCredential: true })
    expect(mocks.vaultWrite).not.toHaveBeenCalled()
  })

  it('writes no vault entry for an update that carries no secret', async () => {
    await updateHost('host-1', { isFavorite: true })
    expect(mocks.vaultWrite).not.toHaveBeenCalled()
  })
})

describe('deleteHost removes the vault entries too', () => {
  it('deletes the row and then every credential kind', async () => {
    await deleteHost('host-1')
    expect(mocks.executeQuery).toHaveBeenCalledWith(
      'DELETE FROM hosts WHERE id = ?',
      ['host-1'],
    )
    // The row had no reference, so nothing is removed: a delete must not sweep
    // keys the row never claimed.
    expect(mocks.vaultRemoveVersion).not.toHaveBeenCalled()
  })

  it('deletes the row even when the vault refuses', async () => {
    mocks.vaultRemove.mockRejectedValue(new Error('vault locked'))
    await expect(deleteHost('host-1')).resolves.toBeUndefined()
    expect(mocks.executeQuery).toHaveBeenCalled()
  })
})
