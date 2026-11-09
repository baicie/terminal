// Migration of legacy plaintext: plans without printing secrets, proves every
// value round-trips before clearing a column, and leaves a failed row untouched.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  isEmptyPlan,
  migrationComplete,
  planCredentialMigration,
  runCredentialMigration,
} from './credential-migration'
import type { CredentialRef } from './credential-boundary'
import type { MigrationPlan, MigrationStore, MigrationVault } from './credential-migration'

type Resource = { type: 'host' | 'ssh-key', id: string }

class FakeVault implements MigrationVault {
  available = true
  readonly store = new Map<string, string>()
  readonly writes: string[] = []
  failOnWrite: string | null = null
  /** When set, reads return a value that differs from what was written. */
  corruptReads = false

  private key(resource: Resource, version: number, kind: string): string {
    return `${resource.type}:${resource.id}:${version}:${kind}`
  }

  async isAvailable(): Promise<boolean> {
    return this.available
  }

  async write(
    resource: Resource,
    version: number,
    kind: 'password' | 'privateKey' | 'passphrase',
    value: string,
  ): Promise<void> {
    if (this.failOnWrite === resource.id) throw new Error('vault write failed')
    this.writes.push(this.key(resource, version, kind))
    this.store.set(this.key(resource, version, kind), value)
  }

  async read(
    resource: Resource,
    version: number,
    kind: 'password' | 'privateKey' | 'passphrase',
  ): Promise<string | undefined> {
    const stored = this.store.get(this.key(resource, version, kind))
    return this.corruptReads && stored !== undefined ? `${stored}-corrupt` : stored
  }

  async remove(
    resource: Resource,
    version: number,
    kind: 'password' | 'privateKey' | 'passphrase',
  ): Promise<void> {
    this.store.delete(this.key(resource, version, kind))
  }
}

class FakeStore implements MigrationStore {
  readonly committedHosts: Array<{ id: string, ref: unknown }> = []
  readonly committedKeys: Array<{ id: string, ref: unknown }> = []
  failOnHost: string | null = null

  async commitHost(id: string, ref: CredentialRef): Promise<void> {
    if (this.failOnHost === id) throw new Error('sqlite write failed')
    this.committedHosts.push({ id, ref })
  }

  async commitKey(id: string, ref: CredentialRef): Promise<void> {
    this.committedKeys.push({ id, ref })
  }
}

let vault: FakeVault
let store: FakeStore

beforeEach(() => {
  vault = new FakeVault()
  store = new FakeStore()
})

describe('planCredentialMigration', () => {
  it('finds rows that still hold plaintext', () => {
    const plan = planCredentialMigration(
      [
        { id: 'h1', name: 'a', password: 'p', privateKey: null },
        { id: 'h2', name: 'b', password: null, privateKey: 'k' },
        { id: 'h3', name: 'clean', password: null, privateKey: null },
      ],
      [{ id: 'k1', name: 'key', privateKey: 'kk', passphrase: 'pp' }],
    )
    expect(plan.hosts.map(host => host.id)).toEqual(['h1', 'h2'])
    expect(plan.keys.map(key => key.id)).toEqual(['k1'])
  })

  it('counts already-migrated rows separately without touching them', () => {
    const plan = planCredentialMigration(
      [
        {
          id: 'h1',
          name: 'done',
          password: null,
          privateKey: null,
          credentialRef: { kinds: ['password'], provider: 'vault' },
        },
      ],
      [],
    )
    expect(plan.hosts).toEqual([])
    expect(plan.alreadyMigrated).toBe(1)
  })

  it('never prints a secret in the summary', () => {
    const plan = planCredentialMigration(
      [{ id: 'h1', name: 'a', password: 'super-secret', privateKey: 'KEY-MATERIAL' }],
      [],
    )
    expect(plan.summary).not.toContain('super-secret')
    expect(plan.summary).not.toContain('KEY-MATERIAL')
    expect(plan.summary).toMatch(/1 host\(s\) with 2 secret\(s\)/)
  })

  it('reports nothing to do when the database is already clean', () => {
    const plan = planCredentialMigration(
      [{ id: 'h1', name: 'clean', password: null, privateKey: null }],
      [],
    )
    expect(isEmptyPlan(plan)).toBe(true)
    expect(plan.summary).toMatch(/nothing to migrate/i)
  })

  it('counts each kind separately for the preview', () => {
    const plan = planCredentialMigration(
      [{ id: 'h1', name: 'a', password: 'p', privateKey: null }],
      [{ id: 'k1', name: 'key', privateKey: 'kk', passphrase: 'pp' }],
    )
    expect(plan.counts).toEqual({
      hostPasswords: 1,
      hostPrivateKeys: 0,
      sshKeyPrivateKeys: 1,
      sshKeyPassphrases: 1,
    })
  })
})

describe('runCredentialMigration', () => {
  // The plan names kinds only; the values travel separately, so a plan can be
  // rendered or logged without carrying a secret.
  const plan: MigrationPlan = {
    hosts: [
      { id: 'h1', name: 'a', kinds: ['password'], credentialRef: null },
      { id: 'h2', name: 'b', kinds: ['privateKey'], credentialRef: null },
    ],
    keys: [
      { id: 'k1', name: 'key', kinds: ['privateKey', 'passphrase'], credentialRef: null },
    ],
    alreadyMigrated: 0,
    counts: {
      hostPasswords: 1,
      hostPrivateKeys: 1,
      sshKeyPrivateKeys: 1,
      sshKeyPassphrases: 1,
    },
    summary: '',
  }

  const values = {
    hosts: [
      { id: 'h1', password: 'p1', privateKey: null },
      { id: 'h2', password: null, privateKey: 'k2' },
    ],
    keys: [{ id: 'k1', privateKey: 'kk', passphrase: 'pp' }],
  }

  it('moves every secret and commits each row', async () => {
    const result = await runCredentialMigration(plan, values, vault, store)

    expect(result.migratedHosts).toBe(2)
    expect(result.migratedKeys).toBe(1)
    expect(result.failed).toEqual([])
    expect(migrationComplete(result)).toBe(true)
    expect(vault.store.get('host:h1:1:password')).toBe('p1')
    expect(store.committedHosts.map(entry => entry.id)).toEqual(['h1', 'h2'])
    // Every committed reference names the version its secret was written under.
    expect(store.committedHosts[0].ref).toEqual({
      kinds: ['password'],
      provider: 'vault',
      version: 1,
    })
  })

  it('aborts entirely when the vault is locked', async () => {
    vault.available = false
    const result = await runCredentialMigration(plan, values, vault, store)

    expect(result.aborted).toBe(true)
    expect(result.migratedHosts).toBe(0)
    // Nothing was written, so no row lost its plaintext.
    expect(vault.store.size).toBe(0)
    expect(store.committedHosts).toEqual([])
    expect(migrationComplete(result)).toBe(false)
  })

  it('leaves a row untouched when its vault write fails', async () => {
    vault.failOnWrite = 'h1'
    const result = await runCredentialMigration(plan, values, vault, store)

    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({ id: 'h1', kind: 'host' })
    // The failed host was never committed: its plaintext is still the source of truth.
    expect(store.committedHosts.map(entry => entry.id)).toEqual(['h2'])
    expect(migrationComplete(result)).toBe(false)
  })

  it('does not clear a row whose vault value cannot be read back', async () => {
    vault.corruptReads = true
    const result = await runCredentialMigration(plan, values, vault, store)

    expect(result.failed).toHaveLength(3)
    expect(store.committedHosts).toEqual([])
    expect(store.committedKeys).toEqual([])
  })

  it('leaves a host untouched when the database write fails', async () => {
    store.failOnHost = 'h2'
    const result = await runCredentialMigration(plan, values, vault, store)

    expect(result.failed.map(entry => entry.id)).toEqual(['h2'])
    // h2's secret is in the vault but its row still points at plaintext, so the
    // old path keeps working and a retry is safe (same vault key).
    expect(vault.store.get('host:h2:1:privateKey')).toBe('k2')
  })

  it('is idempotent: running it twice migrates nothing the second time', async () => {
    await runCredentialMigration(plan, values, vault, store)
    const afterFirst = planCredentialMigration([], [])
    const second = await runCredentialMigration(afterFirst, { hosts: [], keys: [] }, vault, store)
    expect(second.migratedHosts).toBe(0)
    expect(second.migratedKeys).toBe(0)
  })

  it('does nothing at all for an empty plan', async () => {
    const empty = planCredentialMigration([], [])
    const result = await runCredentialMigration(empty, { hosts: [], keys: [] }, vault, store)
    expect(result).toMatchObject({ migratedHosts: 0, migratedKeys: 0, aborted: false })
    expect(vault.store.size).toBe(0)
  })
})
