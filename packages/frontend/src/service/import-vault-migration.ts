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
import type { CredentialRef } from './credential-boundary'
import { parseCredentialRef } from './credential-ref'
import { select } from './database/connection'
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
 * migrated secret at version 1 replaces whatever this device already stores at
 * version 1 — which is a *live* generation for any host whose row points there.
 * Merge mode makes it worse: the row is left alone, so it keeps pointing at
 * version 1 and now resolves to the imported value. The user's current password is
 * silently gone from the vault.
 *
 * So the rule is the same one every other write path uses: read what the row points
 * at, and write the next generation above it.
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
  let rows: Array<{ credential_ref: string | null }>
  try {
    rows = await select<{ credential_ref: string | null }>(
      `SELECT credential_ref FROM ${table} WHERE id = ?`,
      [id],
    )
  } catch {
    // Could not read: assume the worst (a live generation may be there) and start
    // far enough above version 1 that a collision is not possible for any row this
    // build wrote. Writing a fresh, unreferenced generation is always safe; only
    // *overwriting* one is not.
    // Well under MAX_SUPPORTED_VERSION (1e9) so the reference this writes is still
    // readable by this build, and far above any version it would have written.
    return 10_000
  }
  const raw = rows.length > 0 ? rows[0].credential_ref : null
  const parsed = parseCredentialRef(raw)
  const current: CredentialRef | null = parsed.ok ? parsed.ref : null
  return current === null ? 1 : refVersion(current) + 1
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
      await vaultSecretProvider.write(resource, version, kind, value)
      if ((await vaultSecretProvider.read(resource, version, kind)) !== value) {
        throw new Error(
          `The vault did not return the ${kind} it was just given, so nothing was imported.`,
        )
      }
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
      await vaultSecretProvider.write(resource, version, kind, value)
      if ((await vaultSecretProvider.read(resource, version, kind)) !== value) {
        throw new Error(
          `The vault did not return the ${kind} it was just given, so nothing was imported.`,
        )
      }
    }
    bound.push({
      resource: 'sshKey',
      id,
      boundRef: JSON.stringify({ kinds, provider: 'vault', version }),
    })
  }

  return bound
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

