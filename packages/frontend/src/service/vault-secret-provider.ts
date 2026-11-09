/**
 * Vault-backed `SecretProvider`.
 *
 * The vault is the only store of secret material. Everything this module writes
 * goes through `vaultService`, which talks to the Rust vault (Argon2id + AES-GCM)
 * and never to SQLite.
 *
 * Key naming is per host and per kind, so removing one host's secret cannot touch
 * another's, and a reference that names `privateKey` can never read a password.
 */

import type { CredentialKind, SecretProvider } from './credential-boundary'
import { toVaultCommandError, vaultService } from './vault'

const KEY_PREFIX = 'host'

function vaultKey(hostId: string, kind: CredentialKind): string {
  return `${KEY_PREFIX}:${hostId}:${kind}`
}

/**
 * Why the vault cannot take a secret right now.
 *
 * `uninitialized` and `locked` used to collapse into a single `false`, so a user
 * on a fresh install was told to "unlock" a vault that did not exist yet — an
 * instruction that cannot be followed. They are separate states because they
 * need separate next steps: create, or unlock.
 */
export type VaultAvailability =
  | { ok: true }
  | { ok: false; state: 'uninitialized' | 'locked' | 'unusable' }

export class VaultSecretProvider implements SecretProvider {
  async isAvailable(): Promise<boolean> {
    return (await this.availability()).ok
  }

  /** The same check, with the reason kept so the caller can act on it. */
  async availability(): Promise<VaultAvailability> {
    try {
      if (await vaultService.isUnlocked()) return { ok: true }
    } catch {
      // Fall through to the file check: a failing status call says nothing
      // about whether the vault file is there.
    }
    try {
      return (await vaultService.exists())
        ? { ok: false, state: 'locked' }
        : { ok: false, state: 'uninitialized' }
    } catch {
      // Could not even ask. Treat it as unusable rather than guessing a fix.
      return { ok: false, state: 'unusable' }
    }
  }

  async read(
    hostId: string,
    kind: CredentialKind,
  ): Promise<string | undefined> {
    try {
      return await vaultService.get(vaultKey(hostId, kind))
    } catch (error) {
      // Only "this key does not exist" is absence. A locked vault or a failed
      // decrypt must reach the resolver as an error, not as "no secret".
      //
      // The Rust side serialises the error as `{ type: 'key_not_found', ... }`,
      // so the discriminator is read through `toVaultCommandError` rather than
      // off a guessed property name — reading `.kind` here silently matched
      // nothing, which made removal of a never-stored kind throw.
      if (toVaultCommandError(error).kind === 'key_not_found') return undefined
      throw error
    }
  }

  async write(
    hostId: string,
    kind: CredentialKind,
    value: string,
  ): Promise<void> {
    await vaultService.set(vaultKey(hostId, kind), value)
  }

  async remove(hostId: string, kind: CredentialKind): Promise<void> {
    try {
      await vaultService.delete(vaultKey(hostId, kind))
    } catch (error) {
      if (toVaultCommandError(error).kind === 'key_not_found') return
      throw error
    }
  }
}

export const vaultSecretProvider = new VaultSecretProvider()
