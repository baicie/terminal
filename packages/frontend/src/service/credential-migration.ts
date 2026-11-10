/**
 * Migration of pre-Phase-10 plaintext credentials into the vault.
 *
 * This module *plans*, *runs* and *verifies* the migration. It does not run on
 * startup and does not run without the user saying so, because it writes secrets
 * into the vault (which needs an unlocked master password) and then clears
 * plaintext columns that the old build still reads. Doing that behind the user's
 * back would be exactly the kind of irreversible cleanup the ADR forbids.
 *
 * The plan is deliberately boring and inspectable:
 *
 *   1. find rows that still hold plaintext;
 *   2. say how many, and of which kind, without printing any of the values;
 *   3. write each value to the vault *under a new version* and read it back;
 *   4. only then write the reference and clear the column;
 *   5. if step 3 fails for a row, that row keeps its plaintext and its old
 *      behaviour, and the migration reports it as failed rather than half-done.
 *
 * Re-running is safe by construction. A row that already has a reference and no
 * plaintext is skipped; a row that failed last time is retried from its plaintext,
 * because nothing was cleared. There is no journal to corrupt, and no "resume
 * point" that can point at a half-written row: the row itself is the state.
 */

import type { CredentialRef } from './credential-boundary'

/**
 * One host row that still carries plaintext that can be migrated.
 *
 * The plaintext is deliberately **not** a field. A plan is shown to the user, held
 * in component state and can end up in a log line; a type that carries the value
 * makes every one of those a place a secret can leak, and the leak is invisible
 * because the value is a normal-looking string. The migration takes the values from
 * a separate read whose lifetime is the execution itself — see
 * `credential-migration-run.ts`.
 */
export interface MigratableHost {
  id: string
  name: string
  /** Which kinds to move. Says nothing about their values. */
  kinds: Array<'password' | 'privateKey'>
  /** Existing reference, if a previous partial migration wrote one. */
  credentialRef: CredentialRef | null
}

/** One ssh key row that still carries plaintext. Same rule: no values. */
export interface MigratableKey {
  id: string
  name: string
  kinds: Array<'privateKey' | 'passphrase'>
  /** Existing reference on the key row, if any. */
  credentialRef: CredentialRef | null
}

/**
 * The plaintext the migration is about to move.
 *
 * A separate type from the plan, and passed separately to
 * `runCredentialMigration`, so "the plan" can never be the thing that holds a
 * secret. The runner receives both and pairs them by id; a row missing here is
 * treated as a failed row, never as "nothing to move".
 */
export interface HostSecretValues {
  id: string
  password: string | null
  privateKey: string | null
}

export interface KeySecretValues {
  id: string
  privateKey: string | null
  passphrase: string | null
}

/**
 * What the migration found.
 *
 * Every number here is a count. Nothing in this type can hold a secret, because the
 * plan is shown to the user and written to a log line.
 */
export interface MigrationPlan {
  hosts: MigratableHost[]
  keys: MigratableKey[]
  /** Rows already migrated (reference present, columns empty). Reported, not touched. */
  alreadyMigrated: number
  /** Per-kind totals, so the preview can be specific. */
  counts: {
    hostPasswords: number
    hostPrivateKeys: number
    sshKeyPrivateKeys: number
    sshKeyPassphrases: number
  }
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
    credentialRef?: CredentialRef | null
  }>,
): MigrationPlan {
  const hosts: MigratableHost[] = []
  const keys: MigratableKey[] = []
  let alreadyMigrated = 0

  for (const row of hostRows) {
    const kinds: Array<'password' | 'privateKey'> = []
    if (row.password !== null && row.password !== undefined) kinds.push('password')
    if (row.privateKey !== null && row.privateKey !== undefined) {
      kinds.push('privateKey')
    }
    if (kinds.length === 0) {
      if (row.credentialRef != null) alreadyMigrated += 1
      continue
    }
    hosts.push({
      id: row.id,
      name: row.name,
      kinds,
      credentialRef: row.credentialRef ?? null,
    })
  }

  for (const row of keyRows) {
    const kinds: Array<'privateKey' | 'passphrase'> = []
    if (row.privateKey !== null && row.privateKey !== undefined) {
      kinds.push('privateKey')
    }
    if (row.passphrase !== null && row.passphrase !== undefined) {
      kinds.push('passphrase')
    }
    if (kinds.length === 0) {
      if (row.credentialRef != null) alreadyMigrated += 1
      continue
    }
    keys.push({
      id: row.id,
      name: row.name,
      kinds,
      credentialRef: row.credentialRef ?? null,
    })
  }

  const counts = {
    hostPasswords: hosts.filter(host => host.kinds.includes('password')).length,
    hostPrivateKeys: hosts.filter(host => host.kinds.includes('privateKey')).length,
    sshKeyPrivateKeys: keys.filter(key => key.kinds.includes('privateKey')).length,
    sshKeyPassphrases: keys.filter(key => key.kinds.includes('passphrase')).length,
  }
  return {
    hosts,
    keys,
    alreadyMigrated,
    counts,
    summary:
      hosts.length === 0 && keys.length === 0
        ? 'Nothing to migrate: no host or key still stores a plaintext secret.'
        : `${hosts.length} host(s) with ${counts.hostPasswords + counts.hostPrivateKeys} secret(s) and ${keys.length} key(s) with ${counts.sshKeyPrivateKeys + counts.sshKeyPassphrases} secret(s) still live in the database in plaintext. ${alreadyMigrated} row(s) are already migrated.`,
  }
}

export function isEmptyPlan(plan: MigrationPlan): boolean {
  return plan.hosts.length === 0 && plan.keys.length === 0 && plan.counts.hostPasswords === 0
}

/** What the migration needs from its environment, so it can be tested. */
export interface MigrationVault {
  isAvailable(): Promise<boolean>
  write(
    resource: { type: 'host' | 'ssh-key', id: string },
    version: number,
    kind: 'password' | 'privateKey' | 'passphrase',
    value: string,
  ): Promise<void>
  read(
    resource: { type: 'host' | 'ssh-key', id: string },
    version: number,
    kind: 'password' | 'privateKey' | 'passphrase',
  ): Promise<string | undefined>
  remove?(
    resource: { type: 'host' | 'ssh-key', id: string },
    version: number,
    kind: 'password' | 'privateKey' | 'passphrase',
  ): Promise<void>
}

/**
 * What the migration writes back to SQLite.
 *
 * Both methods must be *committed* before the runner counts the row as migrated: a
 * reference written without clearing the plaintext leaves the secret in two places,
 * which is not a migration, and clearing without the reference loses it.
 */
export interface MigrationStore {
  /** Writes the reference and clears the plaintext columns for one host. */
  commitHost(id: string, ref: CredentialRef): Promise<void>
  /** Writes the reference and clears the plaintext columns for one key. */
  commitKey(id: string, ref: CredentialRef): Promise<void>
}

export interface MigrationFailure {
  id: string
  kind: 'host' | 'key'
  name: string
  /** Why it failed. Never contains the value the migration was moving. */
  reason: string
  /** True when the row kept its plaintext and can simply be retried. */
  retryable: boolean
}

export interface MigrationResult {
  migratedHosts: number
  migratedKeys: number
  /** Rows that could not be migrated; their plaintext was left intact. */
  failed: MigrationFailure[]
  /** True when nothing was attempted because the vault is unavailable. */
  aborted: boolean
  /** Why it was aborted, for the UI. No secret material. */
  abortReason?: 'vault-uninitialized' | 'vault-locked' | 'vault-unusable'
  /** Secrets the vault accepted but whose row could not be updated. */
  orphanedSecrets: number
}

// The runner lives in its own module; re-exported so callers keep one import for
// the migration as a whole.
export {
  migrationComplete,
  runCredentialMigration,
} from './credential-migration-runner'
