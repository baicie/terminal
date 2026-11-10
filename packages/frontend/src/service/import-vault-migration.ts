/**
 * Moving an import file's plaintext secrets into this device's vault.
 *
 * This is the `migrate` policy's first half, and it runs *before* the database
 * import. Ordering matters: if the vault refuses, nothing has been written to
 * SQLite yet, so the user can retry, create the vault, or choose `discard` — the
 * import has not half-happened.
 *
 * Each value is read back before its reference is produced. A reference for a
 * secret the vault does not actually hold is worse than no import: it makes the
 * target device claim a credential that does not exist.
 */

import { refVersion } from './credential-boundary'
import type { CredentialKind } from './credential-boundary'
import { parseCredentialRef } from './credential-ref'
import { selectStrict } from './database/connection'
import { diagnoseImport, hostSecretKinds, sshKeySecretKinds } from './import-security'
import { vaultUnavailableMessage } from './vault-unavailable-message'
import { vaultSecretProvider } from './vault-secret-provider'

type Resource = Record<string, unknown>

/** One credential moved into this device's vault during an import. */
export interface BoundCredential {
  resource: 'host' | 'sshKey'
  id: string
  /** The reference to store, serialised for the `credential_ref` column. */
  boundRef: string
}

/**
 * Move a file's plaintext secrets into this device's vault.
 *
 * This is the `migrate` policy's first half, and it runs *before* the database
 * import. Ordering matters: if the vault refuses, nothing has been written to
 * SQLite yet, so the user can retry, create the vault, or choose `discard` — the
 * import has not half-happened.
 *
 * Each value is read back before its reference is produced. A reference for a
 * secret the vault does not actually hold is worse than no import: it makes the
 * target device claim a credential that does not exist.
 */
/**
 * The version an imported secret must be written under.
 *
 * Never a fixed number. `vaultService.set` overwrites unconditionally, so writing a
 * migrated secret at a guessed version replaces whatever this device already stores
 * there — and in Merge mode the row is left alone, so it keeps pointing at that
 * version and now resolves to the imported value. The user's current password is
 * silently gone from the vault.
 *
 * The rule is the same one every other write path uses: read what the row points
 * at, and write the next generation above it. When the row cannot be read, there is
 * no version that is safe to guess:
 *
 * - a fixed number collides with any row that happens to point at it;
 * - "no rows" (what a swallowed query error looks like) reads as "nothing stored"
 *   and picks version 1, the generation most likely to be live.
 *
 * So an unreadable row refuses the write. The import can be retried once the
 * database is usable; a credential it destroyed cannot.
 */
export type VersionResolver = (
  resource: 'host' | 'sshKey',
  id: string,
) => Promise<number>

/** Read the local row's reference and return the generation after it. */
async function localNextVersion(
  resource: 'host' | 'sshKey',
  id: string,
): Promise<number> {
  const table = resource === 'host' ? 'hosts' : 'ssh_keys'
  // `selectStrict`, not `select`: `select` converts a failed query into `[]`, and
  // `[]` is indistinguishable from "this row has no reference" — which would pick
  // version 1 and overwrite a live generation. The same function is used by
  // startup recovery for exactly this reason.
  let rows: Array<{ credential_ref: string | null }>
  try {
    rows = await selectStrict<{ credential_ref: string | null }>(
      `SELECT credential_ref FROM ${table} WHERE id = ?`,
      [id],
    )
  } catch (error) {
    throw new Error(
      `The ${resource === 'host' ? 'host' : 'key'} ${id} could not be read, so its stored credential cannot be moved aside safely and nothing was imported.`,
      { cause: error },
    )
  }
  const raw = rows.length > 0 ? rows[0].credential_ref : null
  const parsed = parseCredentialRef(raw)
  if (!parsed.ok) {
    // Something is stored and this build cannot name it. Treating that as "never
    // stored" would write version 1 over a credential the user still has.
    throw new Error(
      `The ${resource === 'host' ? 'host' : 'key'} ${id} has a stored credential this build cannot read, so nothing was imported.`,
    )
  }
  return parsed.ref === null ? 1 : refVersion(parsed.ref) + 1
}

export async function migrateSecretToVault(
  data: { hosts?: unknown, sshKeys?: unknown },
  options: { versionFor?: VersionResolver } = {},
): Promise<BoundCredential[]> {
  const diagnosis = diagnoseImport(data)
  if (diagnosis.rows.length === 0) return []

  const availability = await vaultSecretProvider.availability()
  if (!availability.ok) {
    throw new Error(vaultUnavailableMessage(availability.state))
  }

  const hosts = Array.isArray(data.hosts) ? (data.hosts as Resource[]) : []
  const keys = Array.isArray(data.sshKeys) ? (data.sshKeys as Resource[]) : []
  const bound: BoundCredential[] = []

  // Everything this call writes, recorded *as it lands*, not per row.
  //
  // The old shape pushed one entry after a whole row succeeded, so a throw part-way
  // through a row left that row's first kind untracked, and a throw anywhere made
  // every earlier row invisible too — because nothing ran a rollback here at all.
  // Recording each write lets the catch below undo exactly what this call created.
  const written: Array<{
    resource: 'host' | 'sshKey'
    id: string
    kind: CredentialKind
    version: number
  }> = []

  /**
   * Put one secret in the vault and verify it is really there.
   *
   * The read-back is what makes the reference honest: a reference for a secret the
   * vault does not hold makes the target device claim a credential that does not
   * exist, and reports it at connect time as "the vault holds none".
   */
  const store = async (
    resourceType: 'host' | 'sshKey',
    resource: { type: 'host' | 'ssh-key', id: string },
    version: number,
    kind: CredentialKind,
    value: string,
  ) => {
    await vaultSecretProvider.write(resource, version, kind, value)
    written.push({ resource: resourceType, id: resource.id, kind, version })
    if ((await vaultSecretProvider.read(resource, version, kind)) !== value) {
      throw new Error(
        `The vault did not return the ${kind} it was just given, so nothing was imported.`,
      )
    }
  }

  try {
    for (const row of hosts) {
      const kinds = hostSecretKinds(row)
      if (kinds.length === 0) continue
      const id = String(row.id ?? '')
      if (!id) throw new Error('A host in this file has no id, so its secret cannot be stored.')
      const version = options.versionFor
        ? await options.versionFor('host', id)
        : await localNextVersion('host', id)
      const resource = { type: 'host' as const, id }
      const values: Partial<Record<(typeof kinds)[number], string>> = {
        password: typeof row.password === 'string' ? row.password : undefined,
        privateKey: typeof row.private_key === 'string' ? row.private_key : undefined,
      }
      for (const kind of kinds) {
        const value = values[kind]
        if (value === undefined) continue
        await store('host', resource, version, kind, value)
      }
      bound.push({
        resource: 'host',
        id,
        boundRef: JSON.stringify({ kinds, provider: 'vault', version }),
      })
    }

    for (const row of keys) {
      const kinds = sshKeySecretKinds(row)
      if (kinds.length === 0) continue
      const id = String(row.id ?? '')
      if (!id) throw new Error('A key in this file has no id, so its secret cannot be stored.')
      const version = options.versionFor
        ? await options.versionFor('sshKey', id)
        : await localNextVersion('sshKey', id)
      const resource = { type: 'ssh-key' as const, id }
      const values: Partial<Record<(typeof kinds)[number], string>> = {
        privateKey: typeof row.private_key === 'string' ? row.private_key : undefined,
        passphrase: typeof row.passphrase === 'string' ? row.passphrase : undefined,
      }
      for (const kind of kinds) {
        const value = values[kind]
        if (value === undefined) continue
        await store('sshKey', resource, version, kind, value)
      }
      bound.push({
        resource: 'sshKey',
        id,
        boundRef: JSON.stringify({ kinds, provider: 'vault', version }),
      })
    }
  } catch (error) {
    // The prepare half is the only place that knows what it wrote, so it is the
    // only place that can undo it. The caller's `try` starts after this returns;
    // a failure here would otherwise leave every secret written so far orphaned —
    // ciphertext for a resource nothing points at, accumulating across retries.
    //
    // Only the keys this call wrote are touched. A version the row already pointed
    // at is never a candidate: it was live before the import and is live after.
    const failed = await discardWrittenSecrets(written)
    if (failed > 0) {
      // Observable, and never containing a value: the user is told the import
      // failed *and* that cleanup did not finish, instead of being left to
      // believe nothing was written.
      console.warn(
        `[credential] ${failed} secret(s) written by a failed import could not be removed`,
      )
    }
    // The original exception wins. A cleanup error describes the recovery, not the
    // reason the user's import stopped, and replacing it would hide the real cause.
    throw error
  }

  return bound
}

/** Remove exactly the versions this call created. Returns how many failed. */
async function discardWrittenSecrets(
  written: Array<{ resource: 'host' | 'sshKey', id: string, kind: string, version: number }>,
): Promise<number> {
  let failed = 0
  for (const entry of written) {
    const resource = {
      type: entry.resource === 'host' ? ('host' as const) : ('ssh-key' as const),
      id: entry.id,
    }
    try {
      await vaultSecretProvider.remove(resource, entry.version, entry.kind as never)
    } catch {
      failed += 1
    }
  }
  return failed
}

/**
 * Remove the credentials a failed import wrote.
 *
 * A vault write that succeeded followed by a database failure leaves a secret
 * nothing points at. It is not a lost credential — the user can retry — but it is
 * ciphertext for a resource that does not exist, and leaving it would accumulate
 * across retries. Failure to clean up is reported, never thrown: the caller is
 * already handling the import failure.
 */
export async function rollbackMigratedSecrets(
  bound: BoundCredential[],
): Promise<number> {
  let failed = 0
  for (const entry of bound) {
    let parsed: { kinds?: unknown, version?: unknown }
    try {
      parsed = JSON.parse(entry.boundRef) as { kinds?: unknown, version?: unknown }
    } catch {
      failed += 1
      continue
    }
    const kinds = Array.isArray(parsed.kinds) ? parsed.kinds : []
    const version = typeof parsed.version === 'number' ? parsed.version : 1
    const resource = {
      type: entry.resource === 'host' ? ('host' as const) : ('ssh-key' as const),
      id: entry.id,
    }
    for (const kind of kinds) {
      if (kind !== 'password' && kind !== 'privateKey' && kind !== 'passphrase') continue
      try {
        await vaultSecretProvider.remove(resource, version, kind)
      } catch {
        failed += 1
      }
    }
  }
  return failed
}

