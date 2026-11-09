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
export async function migrateSecretToVault(
  data: { hosts?: unknown, sshKeys?: unknown },
  options: { versionFor?: (resource: 'host' | 'sshKey', id: string) => number } = {},
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
    const version = options.versionFor?.('host', id) ?? 1
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
    const version = options.versionFor?.('sshKey', id) ?? 1
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

