/**
 * Migration of pre-Phase-10 plaintext credentials into the vault.
 *
 * This module *plans* and *verifies* the migration. It does not run on startup and
 * does not run without the user saying so, because it writes secrets into the vault
 * (which needs an unlocked master password) and then clears plaintext columns that
 * the old build still reads. Doing that behind the user's back would be exactly the
 * kind of irreversible cleanup the ADR forbids.
 *
 * The plan is deliberately boring and inspectable:
 *
 *   1. find rows that still hold plaintext;
 *   2. say how many, and of which kind, without printing any of the values;
 *   3. write each value to the vault and read it back to prove it round-trips;
 *   4. only then write the reference and clear the column;
 *   5. if step 3 fails for a row, that row keeps its plaintext and its old
 *      behaviour, and the migration reports it as failed rather than half-done.
 */

import { splitHostSecrets } from './credential-boundary'
import type { CredentialRef } from './credential-boundary'

/** One host row that still carries plaintext that can be migrated. */
export interface MigratableHost {
  id: string
  name: string
  password: string | null
  privateKey: string | null
  /** Existing reference, if a previous partial migration wrote one. */
  credentialRef: CredentialRef | null
}

/** One ssh key row that still carries plaintext. */
export interface MigratableKey {
  id: string
  name: string
  privateKey: string | null
  passphrase: string | null
}

export interface MigrationPlan {
  hosts: MigratableHost[]
  keys: MigratableKey[]
  /** Rows already migrated (reference present, columns empty). Reported, not touched. */
  alreadyMigrated: number
  /** Human-readable summary with no secret material in it. */
  summary: string
}

/**
 * Builds the plan from rows as read from the database.
 *
 * A row is migratable when it still has a plaintext secret. A row whose columns are
 * empty but whose reference exists is already migrated; a row with neither is simply
 * a host that stores nothing (agent auth, or a password asked at connect time).
 */
export function planCredentialMigration(
  hostRows: Array<{
    id: string
    name: string
    password?: string | null
    privateKey?: string | null
    credentialRef?: CredentialRef | null
  }>,
  keyRows: Array<{
    id: string
    name: string
    privateKey?: string | null
    passphrase?: string | null
  }>,
): MigrationPlan {
  const hosts: MigratableHost[] = []
  const keys: MigratableKey[] = []
  let alreadyMigrated = 0

  for (const row of hostRows) {
    const password = row.password ?? null
    const privateKey = row.privateKey ?? null
    if (password === null && privateKey === null) {
      if (row.credentialRef != null) alreadyMigrated += 1
      continue
    }
    hosts.push({
      id: row.id,
      name: row.name,
      password,
      privateKey,
      credentialRef: row.credentialRef ?? null,
    })
  }

  for (const row of keyRows) {
    const privateKey = row.privateKey ?? null
    const passphrase = row.passphrase ?? null
    if (privateKey === null && passphrase === null) continue
    keys.push({
      id: row.id,
      name: row.name,
      privateKey,
      passphrase,
    })
  }

  const hostSecrets = hosts.reduce(
    (total, host) =>
      total + (host.password === null ? 0 : 1) + (host.privateKey === null ? 0 : 1),
    0,
  )
  const keySecrets = keys.reduce(
    (total, key) =>
      total + (key.privateKey === null ? 0 : 1) + (key.passphrase === null ? 0 : 1),
    0,
  )

  return {
    hosts,
    keys,
    alreadyMigrated,
    summary:
      hosts.length === 0 && keys.length === 0
        ? 'Nothing to migrate: no host or key still stores a plaintext secret.'
        : `${hosts.length} host(s) with ${hostSecrets} secret(s) and ${keys.length} key(s) with ${keySecrets} secret(s) still live in the database in plaintext. ${alreadyMigrated} row(s) are already migrated.`,
  }
}

export function isEmptyPlan(plan: MigrationPlan): boolean {
  return plan.hosts.length === 0 && plan.keys.length === 0
}

/** The reference a migrated host should carry. */
export function refForMigratedHost(host: MigratableHost): CredentialRef | null {
  return splitHostSecrets({
    password: host.password,
    privateKey: host.privateKey,
  }).ref
}

/** What the migration needs from its environment, so it can be tested. */
export interface MigrationVault {
  isAvailable(): Promise<boolean>
  write(id: string, kind: 'password' | 'privateKey' | 'passphrase', value: string): Promise<void>
  read(id: string, kind: 'password' | 'privateKey' | 'passphrase'): Promise<string | undefined>
}

export interface MigrationStore {
  /** Writes the reference and clears the plaintext columns for one host. */
  commitHost(id: string, ref: CredentialRef): Promise<void>
  /** Writes the vault entries' existence and clears the plaintext columns for one key. */
  commitKey(id: string): Promise<void>
}

export interface MigrationResult {
  migratedHosts: number
  migratedKeys: number
  /** Rows that could not be migrated; their plaintext was left intact. */
  failed: Array<{ id: string, kind: 'host' | 'key', reason: string }>
  /** True when nothing was attempted because the vault is unavailable. */
  aborted: boolean
}

/**
 * Runs the migration.
 *
 * Every secret is written and then read back before any column is cleared. A
 * single failure for a row leaves that row completely untouched: it keeps its
 * plaintext, which the old code path still reads, so the user never ends up with a
 * host whose credential exists nowhere.
 */
export async function runCredentialMigration(
  plan: MigrationPlan,
  vault: MigrationVault,
  store: MigrationStore,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    migratedHosts: 0,
    migratedKeys: 0,
    failed: [],
    aborted: false,
  }
  if (isEmptyPlan(plan)) return result

  // Writing secrets needs an unlocked vault. Aborting here is what keeps a locked
  // vault from being mistaken for "this host had no secret".
  if (!(await vault.isAvailable())) {
    result.aborted = true
    return result
  }

  for (const host of plan.hosts) {
    try {
      const ref = refForMigratedHost(host)
      if (ref === null) continue
      if (host.password !== null) {
        await vault.write(host.id, 'password', host.password)
        if ((await vault.read(host.id, 'password')) !== host.password) {
          throw new Error('the vault did not return the password it was just given')
        }
      }
      if (host.privateKey !== null) {
        await vault.write(host.id, 'privateKey', host.privateKey)
        if ((await vault.read(host.id, 'privateKey')) !== host.privateKey) {
          throw new Error('the vault did not return the private key it was just given')
        }
      }
      await store.commitHost(host.id, ref)
      result.migratedHosts += 1
    } catch (error) {
      // The plaintext is still in the row: the old code path keeps working.
      result.failed.push({
        id: host.id,
        kind: 'host',
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  for (const key of plan.keys) {
    try {
      if (key.privateKey !== null) {
        await vault.write(key.id, 'privateKey', key.privateKey)
        if ((await vault.read(key.id, 'privateKey')) !== key.privateKey) {
          throw new Error('the vault did not return the key it was just given')
        }
      }
      if (key.passphrase !== null) {
        await vault.write(key.id, 'passphrase', key.passphrase)
        if ((await vault.read(key.id, 'passphrase')) !== key.passphrase) {
          throw new Error('the vault did not return the passphrase it was just given')
        }
      }
      await store.commitKey(key.id)
      result.migratedKeys += 1
    } catch (error) {
      result.failed.push({
        id: key.id,
        kind: 'key',
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}

/** True when every secret moved and nothing failed. */
export function migrationComplete(result: MigrationResult): boolean {
  return !result.aborted && result.failed.length === 0
}
