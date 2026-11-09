/**
 * Host CRUD 操作
 */
import type { Host } from '@/types'
import { hostRowToHost } from '@/store/host-mappers'
import { splitHostSecrets } from '@/service/credential-boundary'
import { vaultSecretProvider } from '@/service/vault-secret-provider'
import { executeQuery, select } from './connection'
import type { HostRecord } from './types'

/**
 * Persist a host's secrets to the vault and return the reference to store on the
 * row.
 *
 * The row must never carry the value: `password`, `private_key` and `certificate`
 * are written as NULL unconditionally, and the reference is what tells a later
 * connection where to look. A host with no secrets gets a NULL reference, which is
 * a valid state (agent authentication, or a password asked at connect time).
 *
 * The secrets are written before the row is committed, so a failure to store them
 * fails the save instead of leaving a row whose reference points at nothing.
 */
async function persistHostSecrets(host: {
  id: string
  password?: string | null
  privateKey?: string | null
  passphrase?: string | null
}): Promise<string | null> {
  const { ref, secrets } = splitHostSecrets(host)
  if (secrets.length === 0) return null

  // Fail before touching anything if the vault cannot take the secret. Saying
  // "saved" while the secret only exists in memory is how a user ends up unable
  // to reconnect after a restart.
  if (!(await vaultSecretProvider.isAvailable())) {
    throw new Error(
      'This host has a password or private key, but the vault is locked. Unlock the vault to save it, or connect with an SSH agent or a password typed at connect time instead.',
    )
  }
  for (const secret of secrets) {
    await vaultSecretProvider.write(host.id, secret.kind, secret.value)
  }
  return ref === null ? null : JSON.stringify(ref)
}

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
  const credentialRef = await persistHostSecrets({
    id: host.id,
    password: host.password,
    privateKey: host.privateKey,
  })
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
      credentialRef,
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
  if (clearing) {
    for (const kind of ['password', 'privateKey', 'passphrase'] as const) {
      await vaultSecretProvider.remove(id, kind)
    }
  }
  const credentialRef = hasSecrets
    ? await persistHostSecrets({
        id,
        password: updates.password,
        privateKey: updates.privateKey,
      })
    : undefined

  // The secret columns are cleared only when this call is the one that moves or
  // removes them. A plain edit leaves them alone, because a pre-migration row
  // still keeps its plaintext there and blanking it would destroy the user's
  // only copy before the migration has run.
  const rewriteSecrets = hasSecrets || clearing

  await executeQuery(
    `UPDATE hosts SET name = ?, hostname = ?, port = ?, username = ?, auth_type = ?, password = CASE WHEN ? = 1 THEN NULL ELSE password END, private_key = CASE WHEN ? = 1 THEN NULL ELSE private_key END, certificate = ?, credential_ref = CASE WHEN ? = '' THEN NULL ELSE COALESCE(?, credential_ref) END, group_id = ?, is_favorite = ?, color = ?, tags = ?, port_forwards = ?, startup_command = ?, environment = ?, jump_host_id = ?, jump_host_auth_type = ?, agent_forwarding = ?, shell_integration = ?, updated_at = ? WHERE id = ?`,
    [
      merged.name,
      merged.hostname,
      merged.port,
      merged.username,
      merged.authType,
      rewriteSecrets ? 1 : 0,
      rewriteSecrets ? 1 : 0,
      merged.certificate ?? null,
      // 1st placeholder: the CASE marker ('' means "clear").
      clearing ? '' : 'keep',
      // 2nd placeholder: the new reference, or NULL when there is none.
      credentialRef ?? null,
      merged.groupId ?? null,
      merged.isFavorite ? 1 : 0,
      merged.color ?? null,
      merged.tags ? JSON.stringify(merged.tags) : null,
      JSON.stringify(merged.portForwards ?? []),
      merged.startupCommand ?? null,
      merged.environment ? JSON.stringify(merged.environment) : null,
      merged.jumpHostId ?? null,
      merged.jumpHostAuthType ?? null,
      merged.agentForwarding ? 1 : 0,
      merged.shellIntegration ?? 'off',
      now,
      id,
    ],
  )
}

export async function deleteHost(id: string): Promise<void> {
  // Row first, then the vault: a failure between the two leaves an unreferenced
  // secret (wasteful) rather than a host whose secret is already gone (broken).
  // The reverse order would make the host unrecoverable if the delete failed.
  await executeQuery('DELETE FROM hosts WHERE id = ?', [id])
  for (const kind of ['password', 'privateKey', 'passphrase'] as const) {
    try {
      await vaultSecretProvider.remove(id, kind)
    } catch {
      // A vault that is locked or a kind that was never stored must not make the
      // delete look failed — the row is already gone, so reporting an error here
      // would push the caller into retrying a delete that already happened.
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
