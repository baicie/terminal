// Migration of legacy plaintext: plans without printing secrets, proves every
// value round-trips before clearing a column, and leaves a failed row untouched.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  isEmptyPlan,
  migrationComplete,
  planCredentialMigration,
  refForMigratedHost,
  runCredentialMigration,
} from './credential-migration'
import type { MigrationPlan, MigrationStore, MigrationVault } from './credential-migration'

class FakeVault implements MigrationVault {
  available = true
  readonly store = new Map<string, string>()
  failOnWrite: string | null = null
  /** When set, reads return a value that differs from what was written. */
  corruptReads = false

  async isAvailable(): Promise<boolean> {
    return this.available
  }

  async write(id: string, kind: string, value: string): Promise<void> {
    if (this.failOnWrite === id) throw new Error('vault write failed')
    this.store.set(`${id}:${kind}`, value)
  }

  async read(id: string, kind: string): Promise<string | undefined> {
    const stored = this.store.get(`${id}:${kind}`)
    return this.corruptReads && stored !== undefined ? `${stored}-corrupt` : stored
  }
}

class FakeStore implements MigrationStore {
  readonly committedHosts: Array<{ id: string, ref: unknown }> = []
  readonly committedKeys: string[] = []
  failOnHost: string | null = null

  async commitHost(id: string, ref: unknown): Promise<void> {
    if (this.failOnHost === id) throw new Error('sqlite write failed')
    this.committedHosts.push({ id, ref })
  }

  async commitKey(id: string): Promise<void> {
    this.committedKeys.push(id)
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

  it('builds the reference a migrated host should carry', () => {
    expect(
      refForMigratedHost({
        id: 'h1',
        name: 'a',
        password: 'p',
        privateKey: null,
        credentialRef: null,
      }),
    ).toEqual({ kinds: ['password'], provider: 'vault' })
  })
})

describe('runCredentialMigration', () => {
  const plan: MigrationPlan = {
    hosts: [
      { id: 'h1', name: 'a', password: 'p1', privateKey: null, credentialRef: null },
      { id: 'h2', name: 'b', password: null, privateKey: 'k2', credentialRef: null },
    ],
    keys: [{ id: 'k1', name: 'key', privateKey: 'kk', passphrase: 'pp' }],
    alreadyMigrated: 0,
    summary: '',
  }

  it('moves every secret and commits each row', async () => {
    const result = await runCredentialMigration(plan, vault, store)

    expect(result.migratedHosts).toBe(2)
    expect(result.migratedKeys).toBe(1)
    expect(result.failed).toEqual([])
    expect(migrationComplete(result)).toBe(true)
    expect(vault.store.get('h1:password')).toBe('p1')
    expect(store.committedHosts.map(entry => entry.id)).toEqual(['h1', 'h2'])
  })

  it('aborts entirely when the vault is locked', async () => {
    vault.available = false
    const result = await runCredentialMigration(plan, vault, store)

    expect(result.aborted).toBe(true)
    expect(result.migratedHosts).toBe(0)
    // Nothing was written, so no row lost its plaintext.
    expect(vault.store.size).toBe(0)
    expect(store.committedHosts).toEqual([])
    expect(migrationComplete(result)).toBe(false)
  })

  it('leaves a row untouched when its vault write fails', async () => {
    vault.failOnWrite = 'h1'
    const result = await runCredentialMigration(plan, vault, store)

    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({ id: 'h1', kind: 'host' })
    // The failed host was never committed: its plaintext is still the source of truth.
    expect(store.committedHosts.map(entry => entry.id)).toEqual(['h2'])
    expect(migrationComplete(result)).toBe(false)
  })

  it('does not clear a row whose vault value cannot be read back', async () => {
    vault.corruptReads = true
    const result = await runCredentialMigration(plan, vault, store)

    expect(result.failed).toHaveLength(3)
    expect(store.committedHosts).toEqual([])
    expect(store.committedKeys).toEqual([])
  })

  it('leaves a host untouched when the database write fails', async () => {
    store.failOnHost = 'h2'
    const result = await runCredentialMigration(plan, vault, store)

    expect(result.failed.map(entry => entry.id)).toEqual(['h2'])
    // h2's secret is in the vault but its row still points at plaintext, so the
    // old path keeps working and a retry is safe (same vault key).
    expect(vault.store.get('h2:privateKey')).toBe('k2')
  })

  it('is idempotent: running it twice migrates nothing the second time', async () => {
    await runCredentialMigration(plan, vault, store)
    const afterFirst = planCredentialMigration([], [])
    const second = await runCredentialMigration(afterFirst, vault, store)
    expect(second.migratedHosts).toBe(0)
    expect(second.migratedKeys).toBe(0)
  })

  it('does nothing at all for an empty plan', async () => {
    const empty = planCredentialMigration([], [])
    const result = await runCredentialMigration(empty, vault, store)
    expect(result).toMatchObject({ migratedHosts: 0, migratedKeys: 0, aborted: false })
    expect(vault.store.size).toBe(0)
  })
})
