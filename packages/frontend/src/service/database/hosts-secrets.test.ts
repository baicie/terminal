// The rule this file locks: a host's secret never reaches a SQLite column.
//
// The assertions are on the *SQL and its parameters*, not on a database file, so
// they fail the moment someone reintroduces `host.password` into a statement -
// including through a refactor that "just moves the field".

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  select: vi.fn(),
  vaultWrite: vi.fn(),
}))

vi.mock('./connection', () => ({
  executeQuery: mocks.executeQuery,
  select: mocks.select,
}))

vi.mock('@/service/vault-secret-provider', () => ({
  vaultSecretProvider: {
    write: mocks.vaultWrite,
    read: vi.fn(),
    remove: vi.fn(),
    isAvailable: vi.fn(async () => true),
  },
}))

vi.mock('@/store/host-mappers', () => ({
  hostRowToHost: (row: unknown) => row,
}))

const { createHost, updateHost } = await import('./hosts')

const SECRET_PASSWORD = 'super-secret-password'
const SECRET_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----'

function baseHost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'host-1',
    name: 'prod',
    hostname: 'prod.example.test',
    port: 22,
    username: 'alice',
    authType: 'password',
    isFavorite: false,
    portForwards: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function statementText(): string {
  const [sql] = mocks.executeQuery.mock.calls[0] as [string, unknown[]]
  return sql
}

function parameters(): unknown[] {
  const [, params] = mocks.executeQuery.mock.calls[0] as [string, unknown[]]
  return params
}

beforeEach(() => {
  mocks.executeQuery.mockReset()
  mocks.select.mockReset()
  mocks.vaultWrite.mockReset()
  mocks.vaultWrite.mockResolvedValue(undefined)
})

describe('createHost keeps secrets out of SQLite', () => {
  it('writes the password to the vault and NULL to the column', async () => {
    await createHost(
      baseHost({ password: SECRET_PASSWORD }) as never,
    )

    expect(mocks.vaultWrite).toHaveBeenCalledWith(
      'host-1',
      'password',
      SECRET_PASSWORD,
    )
    const sql = statementText()
    expect(sql).toMatch(/password, private_key, certificate, credential_ref/)
    // The VALUES clause hard-codes NULL for both secret columns.
    expect(sql).toMatch(/VALUES \([^)]*NULL, NULL, \?/)
    // No bind parameter equals the secret.
    expect(parameters()).not.toContain(SECRET_PASSWORD)
    // The reference is persisted instead.
    expect(parameters()).toContainEqual(
      JSON.stringify({ kinds: ['password'], provider: 'vault' }),
    )
  })

  it('writes a private key to the vault and never to the row', async () => {
    await createHost(baseHost({ authType: 'key', privateKey: SECRET_KEY }) as never)

    expect(mocks.vaultWrite).toHaveBeenCalledWith(
      'host-1',
      'privateKey',
      SECRET_KEY,
    )
    expect(parameters()).not.toContain(SECRET_KEY)
    expect(JSON.stringify(parameters())).not.toContain('BEGIN OPENSSH')
  })

  it('stores no reference and no secret for an agent host', async () => {
    await createHost(baseHost({ authType: 'agent' }) as never)

    expect(mocks.vaultWrite).not.toHaveBeenCalled()
    const nullIndex = parameters().indexOf(null)
    expect(nullIndex).toBeGreaterThanOrEqual(0)
    expect(parameters()).not.toContainEqual(
      expect.stringContaining('"provider":"vault"'),
    )
  })

  it('keeps the certificate on the row: it is public material', async () => {
    await createHost(
      baseHost({ authType: 'cert', certificate: 'ssh-ed25519-cert-v01@openssh.com AAAA' }) as never,
    )
    expect(parameters()).toContain('ssh-ed25519-cert-v01@openssh.com AAAA')
  })
})

describe('updateHost keeps secrets out of SQLite', () => {
  it('routes a new password to the vault and nulls the column', async () => {
    await updateHost('host-1', { password: SECRET_PASSWORD } as never)

    expect(mocks.vaultWrite).toHaveBeenCalledWith(
      'host-1',
      'password',
      SECRET_PASSWORD,
    )
    expect(statementText()).toMatch(/password = NULL, private_key = NULL/)
    expect(parameters()).not.toContain(SECRET_PASSWORD)
  })

  it('does not touch stored secrets on an unrelated edit', async () => {
    await updateHost('host-1', { name: 'renamed' } as never)

    // No secret in the update: the vault is not written and the reference is
    // left alone by COALESCE(?, credential_ref).
    expect(mocks.vaultWrite).not.toHaveBeenCalled()
    expect(statementText()).toMatch(/credential_ref = COALESCE\(\?, credential_ref\)/)
    expect(parameters()[parameters().length - 1]).toBe('host-1')
  })
})
