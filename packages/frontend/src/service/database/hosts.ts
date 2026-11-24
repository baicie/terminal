/**
 * Host CRUD 操作
 *
 * The secrets do not travel through this module. Every write of a secret goes
 * through `host-credentials.ts`, which decides the version, writes to the vault and
 * cleans up the generation it replaces; this file only ever binds SQL parameters,
 * and the two secret columns are `NULL` in the statement text.
 */
import type { Host } from '@/types'
import { refVersion } from '@/service/credential-boundary'
import { hostRowToHost } from '@/store/host-mappers'
import { vaultSecretProvider } from '@/service/vault-secret-provider'
import { executeQuery, select, selectStrict } from './connection'
import {
  persistHostSecrets,
  retirePreviousVersion,
} from './host-credentials'
import { assertRowUpdated } from './host-update-guard'
import {
  discardFailedCreate,
  hostIdExists,
  insertHostStatement,
} from './host-create-guard'
import { hostUpdateArgs } from './host-update-args'
import { deleteHost, getHostById } from './host-rows-lifecycle'
import { withHostWriteLock } from './host-write-lock'
export { deleteHost, getHostById }
import type { HostRecord } from './types'

export async function getHosts(): Promise<Host[]> {
  const rows = await select<HostRecord>('SELECT * FROM hosts ORDER BY name')
  return rows.map(hostRowToHost)
}

export async function createHost(
  host: Omit<Host, 'createdAt' | 'updatedAt'>,
): Promise<void> {
  /*
   * RC02: the same per-id lock `updateHost` takes. Without it, two measured interleavings
   * lose data — create/create leaves `vaultKeys: []` beside a live row, and delete-then-
   * recreate lets the delete retire the new host's version 1. Per id, not global; see
   * `host-create-guard.ts` for the measurements.
   */
  return withHostWriteLock(`host:${host.id}`, () => createHostLocked(host))
}

async function createHostLocked(
  host: Omit<Host, 'createdAt' | 'updatedAt'>,
): Promise<void> {
  const now = Date.now()
  /*
   * A duplicate id would overwrite the live row's vault generation and then have it
   * deleted by the cleanup below. See `host-create-guard.ts` for the measurement.
   */
  if (await hostIdExists(host.id)) {
    throw new Error(
      `A host with id ${host.id} already exists; refusing to overwrite its credentials`,
    )
  }

  const persisted = await persistHostSecrets(
    {
      id: host.id,
      password: host.password,
      privateKey: host.privateKey,
    },
    null,
  )
  try {
    const { sql, params } = insertHostStatement(
      host,
      persisted.ref === null ? null : JSON.stringify(persisted.ref),
      now,
    )
    await executeQuery(sql, params)
  } catch (error) {
    /*
     * The row did not land. Remove only what this attempt can prove it created.
     *
     * The read at the top makes a collision here mean "two creates raced", not "an
     * existing host owned this id" — the common duplicate case never reaches the INSERT.
     * Even so, the cleanup is guarded: a row for this id means another writer won, and
     * its reference is what the surviving row will use, so nothing is deleted.
     */
    // Only when nothing owns the id: whoever won a racing create reads the version this
    // attempt wrote, so removing it would be the same loss by a narrower door.
    await discardFailedCreate(host.id, persisted)
    throw error
  }
}

export async function updateHost(
  id: string,
  updates: Partial<Host>,
): Promise<void> {
  /*
   * Serialised per host. Two saves that both read version N would both compute N+1,
   * and the second would overwrite the first's ciphertext while each retired "N" —
   * two "saved" messages and one surviving value. See `host-write-lock.ts`.
   *
   * Read-modify-write of a *credential* is what needs this. An unrelated edit (a
   * rename) also takes the lock: it reads the same row and would otherwise write back
   * a stale `updated_at` and stale fields over a concurrent credential save.
   */
  return withHostWriteLock(`host:${id}`, () => updateHostLocked(id, updates))
}

async function updateHostLocked(
  id: string,
  updates: Partial<Host>,
): Promise<void> {
  const now = Date.now()

  // Merge onto the row that is actually stored. A caller may send only the field
  // it changed — `toggleFavorite` sends `{ isFavorite }` — and binding the raw
  // `Partial` would write NULL into every required column.
  // Strict: a failed read here would otherwise be reported as "does not exist",
  // sending the user to re-create a host that is still in the database.
  const existingRows = await selectStrict<HostRecord>(
    'SELECT * FROM hosts WHERE id = ?',
    [id],
  )
  if (existingRows.length === 0) {
    throw new Error(`Host ${id} does not exist`)
  }
  const existing = hostRowToHost(existingRows[0])
  const merged: Host = { ...existing, ...updates }

  // Only touches secrets when the update actually carries one; an unrelated edit
  // (rename, colour) must not blank a stored credential.
  const hasSecrets = Boolean(updates.password || updates.privateKey)
  const clearing = updates.clearCredential === true

  // Switching to agent authentication means "stop using a stored credential", and
  // it arrives as an update with no secret in it. Treating that as "leave the
  // reference alone" (what COALESCE does) leaves a password in the vault that the
  // user has just told the app not to use, and keeps the row pointing at it.
  //
  // Only an explicit authType change triggers this. A rename also has no secret,
  // and must not silently drop one.
  const switchedToAgent =
    updates.authType === 'agent' && existing.authType !== 'agent'
  if (clearing && hasSecrets) {
    // "Clear" and "set a new one" in the same call is a caller bug, and guessing
    // which one wins could delete a credential the user just typed.
    throw new Error('A host update cannot both clear and set a credential')
  }

  // A damaged reference is not "nothing stored", but the mapper makes them the
  // same value: both arrive as `credentialRef: null`, and only `credentialRefProblem`
  // tells them apart. Writing a secret while ignoring that would pick version 1,
  // write the retyped half over whatever is there, and produce a reference that
  // names only the retyped kinds — orphaning the rest under a version nothing
  // points at. Before Phase 10.1.1 the host at least refused at connect time with
  // "re-save the credentials"; after the write it would silently resolve as
  // password-only, which is strictly worse.
  //
  // This is the write-path half of the guard the connect path already has.
  if (hasSecrets && existing.credentialRefProblem) {
    throw new Error(
      'This host has a stored credential that this build cannot read, so its secrets cannot be updated. Re-save the credential from the host dialog after clearing it.',
    )
  }

  if (switchedToAgent) {
    // Same ordering as `clearing`: stop pointing at the credential first, then
    // remove it. A late failure leaves orphaned ciphertext rather than a row that
    // names a key nothing holds.
    const switched = await executeQuery(
      `UPDATE hosts SET name = ?, hostname = ?, port = ?, username = ?, auth_type = ?, password = NULL, private_key = NULL, certificate = ?, credential_ref = NULL, group_id = ?, is_favorite = ?, color = ?, tags = ?, port_forwards = ?, startup_command = ?, environment = ?, jump_host_id = ?, jump_host_auth_type = ?, agent_forwarding = ?, shell_integration = ?, identity_file_path = NULL, updated_at = ? WHERE id = ?`,
      hostUpdateArgs(merged, now, id, { dropIdentityFilePathArgument: true }),
    )
    // The row must have stopped pointing at the credential before it is removed.
    assertRowUpdated(switched, id)
    await retirePreviousVersion(id, {
      ref: null,
      previousVersion: existing.credentialRef
        ? refVersion(existing.credentialRef)
        : null,
      previousKinds: existing.credentialRef?.kinds ?? [],
    })
    return
  }

  if (clearing) {
    // Clear is the one operation that removes a secret the row still points at, so
    // the *row* has to stop pointing at it first. Doing it the other way round
    // leaves a host whose reference names a key that is already gone — and if the
    // UPDATE then failed, the user would have lost the credential with the row
    // still claiming to have one.
    const cleared = await executeQuery(
      `UPDATE hosts SET name = ?, hostname = ?, port = ?, username = ?, auth_type = ?, password = NULL, private_key = NULL, certificate = ?, credential_ref = NULL, group_id = ?, is_favorite = ?, color = ?, tags = ?, port_forwards = ?, startup_command = ?, environment = ?, jump_host_id = ?, jump_host_auth_type = ?, agent_forwarding = ?, shell_integration = ?, identity_file_path = NULL, updated_at = ? WHERE id = ?`,
      hostUpdateArgs(merged, now, id, { dropIdentityFilePathArgument: true }),
    )
    // If this matched nothing the row still names the secret, and deleting it would
    // leave the secret gone with the reference intact — the worst of both.
    assertRowUpdated(cleared, id)
    // Now that nothing references them, the secrets can go. A failure here leaves
    // orphaned ciphertext, never a host pointing at nothing.
    await retirePreviousVersion(id, {
      ref: null,
      previousVersion: existing.credentialRef
        ? refVersion(existing.credentialRef)
        : null,
      previousKinds: existing.credentialRef?.kinds ?? [],
    })
    return
  }

  const persisted = hasSecrets
    ? await persistHostSecrets(
        {
          id,
          password: updates.password,
          privateKey: updates.privateKey,
          // Lets the write path drop kinds the new auth method cannot use.
          authType: merged.authType,
          previousAuthType: existing.authType,
        },
        existing.credentialRef ?? null,
      )
    : null

  try {
    const written = await executeQuery(
      `UPDATE hosts SET name = ?, hostname = ?, port = ?, username = ?, auth_type = ?, password = CASE WHEN ? = 1 THEN NULL ELSE password END, private_key = CASE WHEN ? = 1 THEN NULL ELSE private_key END, certificate = ?, credential_ref = COALESCE(?, credential_ref), group_id = ?, is_favorite = ?, color = ?, tags = ?, port_forwards = ?, startup_command = ?, environment = ?, jump_host_id = ?, jump_host_auth_type = ?, agent_forwarding = ?, shell_integration = ?, identity_file_path = ?, updated_at = ? WHERE id = ?`,
      hostUpdateArgs(merged, now, id, {
        rewriteSecrets: hasSecrets,
        newRef: persisted?.ref ?? null,
        // A credential now lives in the vault, so the imported path must not keep
        // blocking the connection it was standing in for.
        clearIdentityFilePath: hasSecrets,
      }),
    )
    // No match ⇒ the row still points at the previous version, so the throw below
    // discards the new generation. Checked here so the two paths cannot diverge.
    assertRowUpdated(written, id)
  } catch (error) {
    // The row still points at the previous version, so the generation this attempt
    // wrote is unreachable data. Remove *that* generation — not the previous one,
    // which the row still needs — and let the caller retry from a consistent state.
    if (persisted?.ref && persisted.ref.version !== undefined) {
      await vaultSecretProvider.removeVersion(
        { type: 'host', id },
        persisted.ref.version,
        persisted.ref.kinds,
      )
    }
    throw error
  }

  // Committed: the row points at the new version, so the old one can go. A failure
  // here is orphaned ciphertext, not a lost credential.
  if (persisted) {
    const failed = await retirePreviousVersion(id, persisted)
    if (failed.length > 0) {
      console.warn(
        `[credential] ${failed.length} previous secret(s) for host ${id} could not be removed; the host now uses a newer version`,
      )
    }
  }
}

export async function searchHosts(query: string): Promise<Host[]> {
  const rows = await select<HostRecord>(
    'SELECT * FROM hosts WHERE name LIKE ? OR hostname LIKE ? ORDER BY name LIMIT 50',
    [`%${query}%`, `%${query}%`],
  )
  return rows.map(hostRowToHost)
}

export async function getHostsByGroup(groupId: string | null): Promise<Host[]> {
  if (groupId === null) {
    const rows = await select<HostRecord>(
      'SELECT * FROM hosts WHERE group_id IS NULL ORDER BY name',
    )
    return rows.map(hostRowToHost)
  }
  const rows = await select<HostRecord>(
    'SELECT * FROM hosts WHERE group_id = ? ORDER BY name',
    [groupId],
  )
  return rows.map(hostRowToHost)
}

export async function getFavoriteHosts(): Promise<Host[]> {
  const rows = await select<HostRecord>(
    'SELECT * FROM hosts WHERE is_favorite = 1 ORDER BY name',
  )
  return rows.map(hostRowToHost)
}

/** The host row as stored, for callers that need the reference it now carries. */
export const getPersistedHost = getHostById
