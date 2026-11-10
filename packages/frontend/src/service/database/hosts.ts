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
import { executeQuery, select } from './connection'
import {
  persistHostSecrets,
  retirePreviousVersion,
} from './host-credentials'
import { hostUpdateArgs } from './host-update-args'
import type { HostRecord } from './types'

export async function getHosts(): Promise<Host[]> {
  const rows = await select<HostRecord>('SELECT * FROM hosts ORDER BY name')
  return rows.map(hostRowToHost)
}

export async function getHostById(id: string): Promise<Host | null> {
  const rows = await select<HostRecord>('SELECT * FROM hosts WHERE id = ?', [
    id,
  ])
  if (rows.length === 0) return null
  return hostRowToHost(rows[0])
}

export async function createHost(
  host: Omit<Host, 'createdAt' | 'updatedAt'>,
): Promise<void> {
  const now = Date.now()
  const persisted = await persistHostSecrets(
    {
      id: host.id,
      password: host.password,
      privateKey: host.privateKey,
    },
    null,
  )
  try {
    await executeQuery(
      `INSERT INTO hosts (id, name, hostname, port, username, auth_type, password, private_key, certificate, credential_ref, group_id, is_favorite, color, tags, port_forwards, startup_command, environment, jump_host_id, jump_host_auth_type, agent_forwarding, shell_integration, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        host.id,
        host.name,
        host.hostname,
        host.port,
        host.username,
        host.authType,
        // A certificate is public material; it stays on the row.
        host.certificate ?? null,
        persisted.ref === null ? null : JSON.stringify(persisted.ref),
        host.groupId ?? null,
        host.isFavorite ? 1 : 0,
        host.color ?? null,
        host.tags ? JSON.stringify(host.tags) : null,
        JSON.stringify(host.portForwards),
        host.startupCommand ?? null,
        host.environment ? JSON.stringify(host.environment) : null,
        host.jumpHostId ?? null,
        host.jumpHostAuthType ?? null,
        host.agentForwarding ? 1 : 0,
        host.shellIntegration ?? 'off',
        now,
        now,
      ],
    )
  } catch (error) {
    // The row never landed, so the credential written for it belongs to nothing.
    // Remove the generation this attempt wrote; there is no previous one to keep.
    if (persisted.ref && persisted.ref.version !== undefined) {
      await vaultSecretProvider.removeVersion(
        { type: 'host', id: host.id },
        persisted.ref.version,
        persisted.ref.kinds,
      )
    }
    throw error
  }
}

export async function updateHost(
  id: string,
  updates: Partial<Host>,
): Promise<void> {
  const now = Date.now()

  // Merge onto the row that is actually stored. A caller may send only the field
  // it changed — `toggleFavorite` sends `{ isFavorite }` — and binding the raw
  // `Partial` would write NULL into every required column.
  const existingRows = await select<HostRecord>(
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

  if (clearing) {
    // Clear is the one operation that removes a secret the row still points at, so
    // the *row* has to stop pointing at it first. Doing it the other way round
    // leaves a host whose reference names a key that is already gone — and if the
    // UPDATE then failed, the user would have lost the credential with the row
    // still claiming to have one.
    await executeQuery(
      `UPDATE hosts SET name = ?, hostname = ?, port = ?, username = ?, auth_type = ?, password = NULL, private_key = NULL, certificate = ?, credential_ref = NULL, group_id = ?, is_favorite = ?, color = ?, tags = ?, port_forwards = ?, startup_command = ?, environment = ?, jump_host_id = ?, jump_host_auth_type = ?, agent_forwarding = ?, shell_integration = ?, updated_at = ? WHERE id = ?`,
      hostUpdateArgs(merged, now, id),
    )
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
        },
        existing.credentialRef ?? null,
      )
    : null

  try {
    await executeQuery(
      `UPDATE hosts SET name = ?, hostname = ?, port = ?, username = ?, auth_type = ?, password = CASE WHEN ? = 1 THEN NULL ELSE password END, private_key = CASE WHEN ? = 1 THEN NULL ELSE private_key END, certificate = ?, credential_ref = COALESCE(?, credential_ref), group_id = ?, is_favorite = ?, color = ?, tags = ?, port_forwards = ?, startup_command = ?, environment = ?, jump_host_id = ?, jump_host_auth_type = ?, agent_forwarding = ?, shell_integration = ?, updated_at = ? WHERE id = ?`,
      hostUpdateArgs(merged, now, id, {
        rewriteSecrets: hasSecrets,
        newRef: persisted?.ref ?? null,
      }),
    )
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

export async function deleteHost(id: string): Promise<void> {
  // Row first, then the vault: a failure between the two leaves an unreferenced
  // secret (wasteful) rather than a host whose secret is already gone (broken).
  // The reverse order would make the host unrecoverable if the delete failed.
  const rows = await select<HostRecord>(
    'SELECT credential_ref FROM hosts WHERE id = ?',
    [id],
  )
  const ref = rows.length > 0 ? hostRowToHost(rows[0]).credentialRef : null
  await executeQuery('DELETE FROM hosts WHERE id = ?', [id])
  if (!ref) return
  try {
    await vaultSecretProvider.removeVersion(
      { type: 'host', id },
      refVersion(ref),
      ref.kinds,
    )
  } catch {
    // A vault that is locked must not make the delete look failed — the row is
    // already gone, so reporting an error here would push the caller into retrying
    // a delete that already happened.
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
export async function getPersistedHost(id: string): Promise<Host | null> {
  return getHostById(id)
}
