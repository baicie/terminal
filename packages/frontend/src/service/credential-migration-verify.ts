/**
 * Verifying a migration, and taking the snapshot that makes it reversible.
 *
 * Both live here because they are the two things that must happen *outside* the
 * execution loop: one before it (a copy of the database) and one after (a fresh read
 * that does not trust what the runner reported).
 *
 * The verification deliberately re-reads the tables rather than comparing against
 * the runner's counters. A commit that reported success and did not land is exactly
 * the failure a summary cannot catch.
 */

import { refVersion, parseCredentialRef } from './credential-boundary'
import type { CredentialRef } from './credential-boundary'
import { selectStrict } from './database'
import { vaultSecretProvider } from './vault-secret-provider'

interface HostPlaintextRow {
  id: string
  name: string
  password: string | null
  private_key: string | null
  credential_ref: string | null
}

interface KeyPlaintextRow {
  id: string
  name: string
  private_key: string | null
  passphrase: string | null
  credential_ref: string | null
}

export function readRef(raw: string | null): CredentialRef | null {
  const parsed = parseCredentialRef(raw)
  return parsed.ok ? parsed.ref : null
}

/** Read both tables once, secrets included. */
export async function readPlaintextRows(): Promise<{
  hosts: HostPlaintextRow[]
  keys: KeyPlaintextRow[]
}> {
  const hosts = await selectStrict<HostPlaintextRow>(
    'SELECT id, name, password, private_key, credential_ref FROM hosts',
  )
  const keys = await selectStrict<KeyPlaintextRow>(
    'SELECT id, name, private_key, passphrase, credential_ref FROM ssh_keys',
  )
  return { hosts, keys }
}

/** What a verification pass found. */
export interface MigrationVerification {
  /** Rows that still hold plaintext after the migration claimed to move them. */
  remainingPlaintext: Array<{ id: string, kind: 'host' | 'key', column: string }>
  /** References whose secret the vault cannot read back. */
  unreadableReferences: Array<{ id: string, kind: 'host' | 'key', reason: string }>
  /** Hosts and keys the migration never claimed, so not a failure. */
  skipped: number
  ok: boolean
}

/**
 * Verify the migration against the database and the vault.
 *
 * This is deliberately a *fresh read*, not a summary of what the runner thinks it
 * did: the point is to catch the case where the commit was reported as done and did
 * not land.
 */
export async function verifyCredentialMigration(
  expected: { hostIds: string[], keyIds: string[] },
): Promise<MigrationVerification> {
  const { hosts, keys } = await readPlaintextRows()
  const hostById = new Map(hosts.map(row => [row.id, row]))
  const keyById = new Map(keys.map(row => [row.id, row]))

  const remainingPlaintext: MigrationVerification['remainingPlaintext'] = []
  const unreadableReferences: MigrationVerification['unreadableReferences'] = []

  for (const id of expected.hostIds) {
    const row = hostById.get(id)
    if (!row) continue
    if (row.password !== null) {
      remainingPlaintext.push({ id, kind: 'host', column: 'password' })
    }
    if (row.private_key !== null) {
      remainingPlaintext.push({ id, kind: 'host', column: 'private_key' })
    }
    const ref = readRef(row.credential_ref)
    if (ref === null) {
      unreadableReferences.push({ id, kind: 'host', reason: 'no reference stored' })
      continue
    }
    for (const kind of ref.kinds) {
      const value = await vaultSecretProvider
        .read({ type: 'host', id }, refVersion(ref), kind)
        .catch(() => undefined)
      if (value === undefined) {
        unreadableReferences.push({
          id,
          kind: 'host',
          reason: `the vault holds no ${kind} for this host`,
        })
      }
    }
  }

  for (const id of expected.keyIds) {
    const row = keyById.get(id)
    if (!row) continue
    if (row.private_key !== null) {
      remainingPlaintext.push({ id, kind: 'key', column: 'private_key' })
    }
    if (row.passphrase !== null) {
      remainingPlaintext.push({ id, kind: 'key', column: 'passphrase' })
    }
    const ref = readRef(row.credential_ref)
    if (ref === null) {
      unreadableReferences.push({ id, kind: 'key', reason: 'no reference stored' })
      continue
    }
    for (const kind of ref.kinds) {
      const value = await vaultSecretProvider
        .read({ type: 'ssh-key', id }, refVersion(ref), kind)
        .catch(() => undefined)
      if (value === undefined) {
        unreadableReferences.push({
          id,
          kind: 'key',
          reason: `the vault holds no ${kind} for this key`,
        })
      }
    }
  }

  return {
    remainingPlaintext,
    unreadableReferences,
    skipped: 0,
    ok: remainingPlaintext.length === 0 && unreadableReferences.length === 0,
  }
}

/**
 * Take the pre-migration snapshot.
 *
 * Returns the snapshot path so the UI can tell the user where their copy is. The
 * backend refuses when it cannot produce a verified copy, and this function
 * propagates that refusal: migrating without a backup is the one thing worse than
 * not migrating.
 */
export async function snapshotBeforeCredentialMigration(): Promise<string | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const report = await invoke<{ path?: string, destination?: string }>(
      'backup_database_before_migration',
      { targets: null, migrationId: null },
    )
    return report?.path ?? report?.destination ?? null
  } catch (error) {
    throw new Error(
      `The database could not be backed up, so nothing was migrated: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

