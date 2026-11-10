// Phase 10.1.1 WP2 — the import "prepare" half must undo its own writes.
//
// The defect this locks:
//
// `migrateSecretToVault` runs *before* the `try` in `importWithSecretPolicy`, so
// `rollbackMigratedSecrets` only ever sees the imports that reached the database
// step. When the prepare half itself fails — a read-back mismatch on the second
// kind, an id-less row further down the file, the vault refusing mid-file — every
// secret already written is orphaned: ciphertext for a resource nothing points at,
// accumulating across retries, and the user is told only that the import failed.
//
// Tracking is per-row and only after both kinds succeed, so even the row whose
// first kind landed is invisible to any cleanup that runs later.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  selectStrict: vi.fn(),
  vaultWrite: vi.fn(),
  vaultRead: vi.fn(),
  vaultRemove: vi.fn(),
  vaultRemoveVersion: vi.fn(),
  availability: vi.fn(),
}))

vi.mock('./database/connection', () => ({
  select: mocks.select,
  selectStrict: mocks.selectStrict,
}))

vi.mock('./vault-secret-provider', () => ({
  vaultSecretProvider: {
    write: mocks.vaultWrite,
    read: mocks.vaultRead,
    remove: mocks.vaultRemove,
    removeVersion: mocks.vaultRemoveVersion,
    availability: mocks.availability,
  },
}))

const { migrateSecretToVault } = await import('./import-vault-migration')

/** A vault that records what it holds, keyed the way the real one is. */
class FakeVault {
  readonly entries = new Map<string, string>()
  /** Fail the Nth write (1-based), simulating a transient vault failure. */
  failWriteAt: number | null = null
  /** Return a different value than was written, simulating corruption. */
  corruptKind: string | null = null

  private writes = 0

  key(resource: { type: string; id: string }, version: number, kind: string) {
    return `${resource.type}:${resource.id}:${version}:${kind}`
  }

  install() {
    mocks.availability.mockResolvedValue({ ok: true })
    mocks.vaultWrite.mockImplementation(
      async (
        resource: { type: string; id: string },
        version: number,
        kind: string,
        value: string,
      ) => {
        this.writes += 1
        if (this.failWriteAt !== null && this.writes === this.failWriteAt) {
          throw new Error('vault write refused')
        }
        this.entries.set(this.key(resource, version, kind), value)
      },
    )
    mocks.vaultRead.mockImplementation(
      async (
        resource: { type: string; id: string },
        version: number,
        kind: string,
      ) => {
        if (this.corruptKind === kind) return 'something-else'
        return this.entries.get(this.key(resource, version, kind))
      },
    )
    mocks.vaultRemove.mockImplementation(
      async (
        resource: { type: string; id: string },
        version: number,
        kind: string,
      ) => {
        this.entries.delete(this.key(resource, version, kind))
      },
    )
    mocks.vaultRemoveVersion.mockImplementation(
      async (
        resource: { type: string; id: string },
        version: number,
        kinds: string[],
      ) => {
        for (const kind of kinds) {
          this.entries.delete(this.key(resource, version, kind))
        }
        return []
      },
    )
  }
}

let vault: FakeVault

beforeEach(() => {
  mocks.select.mockReset().mockResolvedValue([])
  mocks.selectStrict.mockReset().mockResolvedValue([])
  mocks.vaultWrite.mockReset()
  mocks.vaultRead.mockReset()
  mocks.vaultRemove.mockReset()
  mocks.vaultRemoveVersion.mockReset()
  mocks.availability.mockReset()
  vault = new FakeVault()
})

/** A backup file shaped the way `diagnoseImport` expects. */
function backup(hosts: unknown[], sshKeys: unknown[] = []) {
  return { hosts, sshKeys }
}

describe('the prepare half compensates for its own failures', () => {
  it('removes the first secret when the second write fails', async () => {
    vault.install()
    vault.failWriteAt = 2

    const file = backup([
      { id: 'h1', name: 'one', password: 'pw-1', private_key: 'key-1' },
    ])

    await expect(migrateSecretToVault(file)).rejects.toThrow()

    // Nothing this call wrote may survive.
    expect(vault.entries.size).toBe(0)
  })

  it('removes both kinds when the read-back of the second disagrees', async () => {
    vault.install()
    vault.corruptKind = 'privateKey'

    const file = backup([
      { id: 'h1', name: 'one', password: 'pw-1', private_key: 'key-1' },
    ])

    await expect(migrateSecretToVault(file)).rejects.toThrow(/did not return/i)
    expect(vault.entries.size).toBe(0)
  })

  it('removes earlier hosts when a later host has no id', async () => {
    vault.install()

    const file = backup([
      { id: 'h1', name: 'one', password: 'pw-1' },
      { name: 'no-id', password: 'pw-2' },
    ])

    await expect(migrateSecretToVault(file)).rejects.toThrow()
    // h1's secret was written before the bad row was reached.
    expect(vault.entries.size).toBe(0)
  })

  it('removes every host secret when the key loop fails', async () => {
    vault.install()

    const file = backup(
      [
        { id: 'h1', name: 'one', password: 'pw-1' },
        { id: 'h2', name: 'two', password: 'pw-2' },
      ],
      [{ name: 'no-id', private_key: 'k' }],
    )

    await expect(migrateSecretToVault(file)).rejects.toThrow()
    expect(vault.entries.size).toBe(0)
  })

  it('does not delete a live generation an earlier import wrote', async () => {
    vault.install()
    // The row points at version 1, which is live for this host.
    mocks.selectStrict.mockResolvedValue([
      { credential_ref: JSON.stringify({ kinds: ['password'], provider: 'vault', version: 1 }) },
    ])
    vault.entries.set('host:h1:1:password', 'live-password')

    vault.failWriteAt = 1
    const file = backup([{ id: 'h1', name: 'one', password: 'pw-1' }])

    await expect(migrateSecretToVault(file)).rejects.toThrow()

    // The version this attempt chose (2) is gone; version 1, which the row still
    // points at, must be untouched.
    expect(vault.entries.get('host:h1:1:password')).toBe('live-password')
  })

  it('keeps the original error when cleanup also fails', async () => {
    vault.install()
    mocks.vaultRemove.mockRejectedValue(new Error('vault is locked'))
    vault.failWriteAt = 2

    const file = backup([
      { id: 'h1', name: 'one', password: 'pw-1', private_key: 'key-1' },
    ])

    // The user must be told what actually stopped the import, not what the
    // cleanup hit afterwards.
    await expect(migrateSecretToVault(file)).rejects.toThrow(/vault write refused/)
  })

  it('reports cleanup that could not complete instead of claiming success', async () => {
    vault.install()
    mocks.vaultRemove.mockRejectedValue(new Error('vault is locked'))
    vault.failWriteAt = 2
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const file = backup([
      { id: 'h1', name: 'one', password: 'pw-1', private_key: 'key-1' },
    ])

    await expect(migrateSecretToVault(file)).rejects.toThrow()
    // A cleanup failure is observable, not silent. The message must not contain
    // secret material.
    const logged = warn.mock.calls.flat().join(' ')
    expect(logged).not.toContain('pw-1')
    warn.mockRestore()
  })
})

describe('a successful prepare still returns one reference per resource', () => {
  it('binds a reference that resolves to what was written', async () => {
    vault.install()
    mocks.selectStrict.mockResolvedValue([])

    const file = backup([{ id: 'h1', name: 'one', password: 'pw-1' }])
    const bound = await migrateSecretToVault(file)

    expect(bound).toHaveLength(1)
    const ref = JSON.parse(bound[0].boundRef) as {
      kinds: string[]
      provider: string
      version: number
    }
    expect(ref.provider).toBe('vault')
    expect(ref.kinds).toEqual(['password'])
    expect(vault.entries.get(`host:h1:${ref.version}:password`)).toBe('pw-1')
  })
})
