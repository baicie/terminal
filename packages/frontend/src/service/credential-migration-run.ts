/**
 * The production side of the credential migration.
 *
 * `credential-migration.ts` holds the rules and is testable with a fake vault. This
 * module is the only thing that touches the real SQLite rows and the real vault, and
 * it exists so the rules cannot quietly acquire a second, untested implementation.
 *
 * What it does, in order, and why that order:
 *
 *   1. **Snapshot.** The migration clears plaintext columns. That is not reversible
 *      from the app, so the user gets a copy of the database first. The snapshot is
 *      the backend's `VACUUM INTO` path (the same one the schema upgrade uses), not
 *      a file copy, so a running WAL cannot produce a torn backup.
 *   2. **Read.** Both tables, secrets included, into memory once. The plan and the
 *      execution must see the same rows; re-reading between them would let a
 *      concurrent save change what is migrated.
 *   3. **Plan + preview.** Counts and row names only; the UI shows this and asks.
 *   4. **Execute.** Each row: write to vault, read back, then commit the reference
 *      and clear the column. Only a committed row counts as migrated.
 *   5. **Verify.** Re-read the tables and assert no plaintext remains for the rows
 *      that succeeded, and that every reference resolves to a readable secret.
 *
 * Known limit, stated rather than hidden: clearing a column does not rewrite SQLite
 * pages that the WAL or an older file still holds. This module does not claim the
 * plaintext is erased from disk — see `docs/phase10/10-credential-boundary-adr.md` §7.
 */

import {
  readPlaintextRows,
  readRef,
  snapshotBeforeCredentialMigration,
  verifyCredentialMigration,
} from './credential-migration-verify'
import type { MigrationVerification } from './credential-migration-verify'
import { planCredentialMigration, runCredentialMigration } from './credential-migration'
import type {
  HostSecretValues,
  KeySecretValues,
  MigrationPlan,
  MigrationResult,
  MigrationStore,
  MigrationVault,
} from './credential-migration'
import { executeQuery } from './database'
import { vaultSecretProvider } from './vault-secret-provider'

// Re-exported so callers and tests keep one import for the migration as a whole.
export {
  readPlaintextRows,
  snapshotBeforeCredentialMigration,
  verifyCredentialMigration,
} from './credential-migration-verify'
export type { MigrationVerification } from './credential-migration-verify'

/**
 * Build the preview without executing anything.
 *
 * The row type it reads carries the plaintext columns, but the plan it returns
 * carries only kinds — the values are dropped here, at the boundary, so a plan can
 * be shown, stored or logged without leaking one.
 */
export async function previewCredentialMigration(): Promise<MigrationPlan> {
  const { hosts, keys } = await readPlaintextRows()
  return planCredentialMigration(
    hosts.map(row => ({
      id: row.id,
      name: row.name,
      password: row.password,
      privateKey: row.private_key,
      credentialRef: readRef(row.credential_ref),
    })),
    keys.map(row => ({
      id: row.id,
      name: row.name,
      privateKey: row.private_key,
      passphrase: row.passphrase,
      credentialRef: readRef(row.credential_ref),
    })),
  )
}

/**
 * The values a preview's ids refer to.
 *
 * Kept out of `MigrationPlan` on purpose: a plan is data the UI holds and may log,
 * while these values exist only for the duration of one execution.
 */
async function readSecretValues(): Promise<{
  hosts: HostSecretValues[]
  keys: KeySecretValues[]
}> {
  const { hosts, keys } = await readPlaintextRows()
  return {
    hosts: hosts.map(row => ({
      id: row.id,
      password: row.password,
      privateKey: row.private_key,
    })),
    keys: keys.map(row => ({
      id: row.id,
      privateKey: row.private_key,
      passphrase: row.passphrase,
    })),
  }
}

/**
 * The real store: one UPDATE per row that both adds the reference and removes the
 * plaintext, so the two cannot disagree.
 */
export function createDatabaseMigrationStore(): MigrationStore {
  return {
    async commitHost(id, ref) {
      await executeQuery(
        'UPDATE hosts SET credential_ref = ?, password = NULL, private_key = NULL WHERE id = ?',
        [JSON.stringify(ref), id],
      )
    },
    async commitKey(id, ref) {
      await executeQuery(
        'UPDATE ssh_keys SET credential_ref = ?, private_key = NULL, passphrase = NULL WHERE id = ?',
        [JSON.stringify(ref), id],
      )
    },
  }
}

/** The real vault, adapted to the migration's narrow interface. */
export function createVaultMigrationVault(): MigrationVault {
  return {
    isAvailable: () => vaultSecretProvider.isAvailable(),
    write: (resource, version, kind, value) =>
      vaultSecretProvider.write(resource, version, kind, value),
    read: (resource, version, kind) =>
      vaultSecretProvider.read(resource, version, kind),
    remove: (resource, version, kind) =>
      vaultSecretProvider.remove(resource, version, kind),
  }
}

/** What the caller gets back from a full run. */
export interface MigrationRunResult extends MigrationResult {
  /** Where the pre-migration copy went, when one was taken. */
  snapshotPath: string | null
  verification: MigrationVerification | null
  plan: MigrationPlan
}

/**
 * Run the migration, with the snapshot, the preview, the execution and the
 * verification in one place.
 *
 * Refuses without an explicit authorisation, because this writes to the vault and
 * clears columns the old build reads.
 */
export async function migratePlaintextCredentials(options: {
  authorized: boolean
  onProgress?: (result: MigrationResult) => void
}): Promise<MigrationRunResult> {
  const plan = await previewCredentialMigration()
  if (!options.authorized) {
    return {
      migratedHosts: 0,
      migratedKeys: 0,
      failed: [],
      aborted: true,
      abortReason: 'vault-locked',
      orphanedSecrets: 0,
      snapshotPath: null,
      verification: null,
      plan,
    }
  }
  if (plan.hosts.length === 0 && plan.keys.length === 0) {
    return {
      migratedHosts: 0,
      migratedKeys: 0,
      failed: [],
      aborted: false,
      orphanedSecrets: 0,
      snapshotPath: null,
      verification: null,
      plan,
    }
  }

  const snapshotPath = await snapshotBeforeCredentialMigration()

  // Read the values only now, after the snapshot succeeded and immediately before
  // the writes. Holding them from the preview until here would keep plaintext in
  // memory across a user decision that may take minutes.
  const values = await readSecretValues()

  const result = await runCredentialMigration(
    plan,
    values,
    createVaultMigrationVault(),
    createDatabaseMigrationStore(),
    options.onProgress,
  )

  const migratedHostIds = plan.hosts
    .filter(host => !result.failed.some(failure => failure.id === host.id))
    .map(host => host.id)
  const migratedKeyIds = plan.keys
    .filter(key => !result.failed.some(failure => failure.id === key.id))
    .map(key => key.id)

  const verification =
    migratedHostIds.length + migratedKeyIds.length > 0
      ? await verifyCredentialMigration({
          hostIds: migratedHostIds,
          keyIds: migratedKeyIds,
        })
      : null

  return { ...result, snapshotPath, verification, plan }
}
