/**
 * RC01 — a failed create must not delete a live host's credentials.
 *
 * ## The defect this module exists for
 *
 * `createHost` writes the secrets to the vault **before** inserting the row, then removes
 * what it wrote if the INSERT fails. That cleanup assumed "the row never landed, so the
 * generation belongs to nothing" — which is true for a fresh id and false for a used one.
 *
 * `persistHostSecrets(host, null)` starts at `nextVersion(null) === 1`, and every host
 * created after 10.1 also lives at version 1. Vault writes overwrite. So a create that
 * collides on the primary key writes **into the same keys the existing row reads**, and
 * the cleanup then deletes them:
 *
 *     create dup-1 with S1   → row + host:dup-1:1:password = S1
 *     create dup-1 with S2   → overwrite to S2, INSERT fails, catch removes version 1
 *     result                 → row still says {version: 1}, secret is gone
 *
 * Measured before the fix: `secretStillReadable: undefined`, `vaultAfter: {}`.
 *
 * ## Why the check is before the write, not in the catch
 *
 * A check inside the catch would have to run *after* S2 had already replaced S1 in the
 * vault, and no amount of care restores ciphertext that was overwritten. The only
 * ordering that cannot lose data is to decide before writing.
 *
 * ## What this does not claim
 *
 * Two concurrent creates can both pass this read; the loser still fails the INSERT, which
 * is why {@link ownsNoRow} guards the cleanup as well. A lock spanning create and update
 * is RC02's subject, not this module's.
 */
import type { CredentialKind } from '@/service/credential-boundary'
import { select } from './connection'

/**
 * Does a host row already use this id?
 *
 * `select` is mocked loosely in several suites and may answer `undefined`; a missing
 * answer is treated as "no row", which is the same thing the product means when the table
 * is empty. The INSERT constraint remains the authority either way.
 */
export async function hostIdExists(id: string): Promise<boolean> {
  const rows = await select('SELECT id FROM hosts WHERE id = ?', [id])
  return Array.isArray(rows) && rows.length > 0
}

/**
 * May this failed create remove the generation it wrote?
 *
 * Only when no row owns the id. If one appeared between the pre-check and the INSERT, it
 * won the race and its `credential_ref` is what the survivor will read — deleting the
 * version it points at would be the same data loss by a narrower door.
 */
export async function ownsNoRow(id: string): Promise<boolean> {
  const rows = await select('SELECT credential_ref FROM hosts WHERE id = ?', [id])
  return !(Array.isArray(rows) && rows.length > 0)
}

/**
 * The INSERT for a new host, with its parameters.
 *
 * Kept beside the guards rather than in `hosts.ts` because all three answer one question —
 * what this create is allowed to touch — and `hosts.ts` is at its line limit. The SQL is
 * unchanged from what shipped; only its location moved.
 *
 * `password` and `private_key` are the literal `NULL` in the statement, not bound
 * parameters: secrets live in the vault, and a placeholder here would invite a future
 * edit to bind one.
 */
export function insertHostStatement(
  host: {
    id: string
    name: string
    hostname: string
    port: number
    username: string
    authType: string
    certificate?: string | null
    groupId?: string | null
    isFavorite?: boolean
    color?: string | null
    tags?: string[]
    portForwards: unknown
    startupCommand?: string | null
    environment?: Record<string, string>
    jumpHostId?: string | null
    jumpHostAuthType?: string | null
    agentForwarding?: boolean
    shellIntegration?: string
    identityFilePath?: string | null
  },
  credentialRefJson: string | null,
  now: number,
): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO hosts (id, name, hostname, port, username, auth_type, password, private_key, certificate, credential_ref, group_id, is_favorite, color, tags, port_forwards, startup_command, environment, jump_host_id, jump_host_auth_type, agent_forwarding, shell_integration, identity_file_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      host.id,
      host.name,
      host.hostname,
      host.port,
      host.username,
      host.authType,
      // A certificate is public material; it stays on the row.
      host.certificate ?? null,
      credentialRefJson,
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
      host.identityFilePath ?? null,
      now,
      now,
    ],
  }
}

/**
 * Remove the generation a failed create wrote, if nothing owns the id.
 *
 * The guard is the point: `persisted.ref.version` is `1`, and a racing create that won
 * the INSERT is reading **that same version**. Deleting it by version alone turns the
 * loser's cleanup into the winner's data loss — measured before RC02: one row survived
 * and `vaultKeys` was empty.
 *
 * Returns whether anything was removed, so the caller can log a real outcome rather
 * than assume one.
 */
export async function discardFailedCreate(
  id: string,
  persisted: { ref: { version?: number; kinds: CredentialKind[] } | null },
): Promise<boolean> {
  if (persisted.ref === null || persisted.ref.version === undefined) return false
  if (!(await ownsNoRow(id))) return false
  const { vaultSecretProvider } = await import('@/service/vault-secret-provider')
  await vaultSecretProvider.removeVersion(
    { type: 'host', id },
    persisted.ref.version,
    persisted.ref.kinds,
  )
  return true
}
