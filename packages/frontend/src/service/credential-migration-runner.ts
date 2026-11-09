/**
 * Executing a credential migration.
 *
 * Split from the planning rules so the rules stay readable: this file is only the
 * order of operations and what each failure leaves behind.
 *
 * The invariant, per row:
 *
 *   1. write every kind to the vault under a *new* version;
 *   2. read each one back;
 *   3. commit the reference and clear the plaintext in one UPDATE.
 *
 * A failure at 1 or 2 removes the half-written generation and leaves the row
 * untouched — its plaintext is still the working credential. A failure at 3 also
 * leaves the row untouched, so the same retry is safe.
 */

import { refVersion, splitHostSecrets } from './credential-boundary'
import type { CredentialRef } from './credential-boundary'
import { isEmptyPlan } from './credential-migration'
import type {
  HostSecretValues,
  KeySecretValues,
  MigrationPlan,
  MigrationResult,
  MigrationStore,
  MigrationVault,
} from './credential-migration'

/** The version a row's new reference will use. */
function migrationVersion(current: CredentialRef | null): number {
  return current === null ? 1 : refVersion(current) + 1
}

/**
 * Runs the migration.
 *
 * Every secret is written and then read back before any column is cleared. A
 * single failure for a row leaves that row completely untouched: it keeps its
 * plaintext, which the old code path still reads, so the user never ends up with a
 * host whose credential exists nowhere.
 *
 * `onProgress` is called after each row with counts only — the caller can persist
 * them as a migration status without ever touching a secret.
 */
export async function runCredentialMigration(
  plan: MigrationPlan,
  values: { hosts: HostSecretValues[], keys: KeySecretValues[] },
  vault: MigrationVault,
  store: MigrationStore,
  onProgress?: (progress: MigrationResult) => void,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    migratedHosts: 0,
    migratedKeys: 0,
    failed: [],
    aborted: false,
    orphanedSecrets: 0,
  }
  if (isEmptyPlan(plan)) return result

  // Writing secrets needs an unlocked vault. Aborting here is what keeps a locked
  // vault from being mistaken for "this host had no secret".
  if (!(await vault.isAvailable())) {
    result.aborted = true
    result.abortReason = 'vault-locked'
    return result
  }

  const hostValues = new Map(values.hosts.map(entry => [entry.id, entry]))
  const keyValues = new Map(values.keys.map(entry => [entry.id, entry]))

  for (const host of plan.hosts) {
    try {
      const plaintext = hostValues.get(host.id)
      if (!plaintext) {
        // The plan said this row has a secret and the read did not produce one.
        // Treating that as "nothing to move" would clear the columns and lose it.
        throw new Error('the plaintext for this host was not read, so nothing was migrated')
      }
      const version = migrationVersion(host.credentialRef)
      const resource = { type: 'host' as const, id: host.id }
      const ref = splitHostSecrets(
        { password: plaintext.password, privateKey: plaintext.privateKey },
        version,
      ).ref
      if (ref === null) continue

      const written: Array<'password' | 'privateKey'> = []
      try {
        if (plaintext.password !== null) {
          await vault.write(resource, version, 'password', plaintext.password)
          written.push('password')
        }
        if (plaintext.privateKey !== null) {
          await vault.write(resource, version, 'privateKey', plaintext.privateKey)
          written.push('privateKey')
        }
        if (plaintext.password !== null) {
          if ((await vault.read(resource, version, 'password')) !== plaintext.password) {
            throw new Error('the vault did not return the password it was just given')
          }
        }
        if (plaintext.privateKey !== null) {
          if ((await vault.read(resource, version, 'privateKey')) !== plaintext.privateKey) {
            throw new Error('the vault did not return the private key it was just given')
          }
        }
      } catch (error) {
        // Do not leave half a generation behind: the row keeps its plaintext, so
        // nothing points at these keys and nothing ever will.
        for (const kind of written) {
          try {
            await vault.remove?.(resource, version, kind)
          } catch {
            // Cleanup is best effort; the row is untouched either way.
          }
        }
        throw error
      }

      await store.commitHost(host.id, ref)
      result.migratedHosts += 1
    } catch (error) {
      result.failed.push({
        id: host.id,
        kind: 'host',
        name: host.name,
        reason: error instanceof Error ? error.message : String(error),
        retryable: true,
      })
    }
    onProgress?.(result)
  }

  for (const key of plan.keys) {
    try {
      const plaintext = keyValues.get(key.id)
      if (!plaintext) {
        throw new Error('the plaintext for this key was not read, so nothing was migrated')
      }
      const version = migrationVersion(key.credentialRef)
      const resource = { type: 'ssh-key' as const, id: key.id }
      const kinds: Array<'privateKey' | 'passphrase'> = []
      if (plaintext.privateKey !== null) kinds.push('privateKey')
      if (plaintext.passphrase !== null) kinds.push('passphrase')
      if (kinds.length === 0) continue
      const ref: CredentialRef = { kinds, provider: 'vault', version }

      const written: Array<'privateKey' | 'passphrase'> = []
      try {
        if (plaintext.privateKey !== null) {
          await vault.write(resource, version, 'privateKey', plaintext.privateKey)
          written.push('privateKey')
        }
        if (plaintext.passphrase !== null) {
          await vault.write(resource, version, 'passphrase', plaintext.passphrase)
          written.push('passphrase')
        }
        if (plaintext.privateKey !== null) {
          if ((await vault.read(resource, version, 'privateKey')) !== plaintext.privateKey) {
            throw new Error('the vault did not return the key it was just given')
          }
        }
        if (plaintext.passphrase !== null) {
          if ((await vault.read(resource, version, 'passphrase')) !== plaintext.passphrase) {
            throw new Error('the vault did not return the passphrase it was just given')
          }
        }
      } catch (error) {
        for (const kind of written) {
          try {
            await vault.remove?.(resource, version, kind)
          } catch {
            // Best effort, as above.
          }
        }
        throw error
      }

      await store.commitKey(key.id, ref)
      result.migratedKeys += 1
    } catch (error) {
      result.failed.push({
        id: key.id,
        kind: 'key',
        name: key.name,
        reason: error instanceof Error ? error.message : String(error),
        retryable: true,
      })
    }
    onProgress?.(result)
  }

  return result
}

/** True when every secret moved and nothing failed. */
export function migrationComplete(result: MigrationResult): boolean {
  return !result.aborted && result.failed.length === 0
}
