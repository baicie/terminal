/**
 * Vault-backed `SecretProvider`.
 *
 * The vault is the only store of secret material. Everything this module writes
 * goes through `vaultService`, which talks to the Rust vault (Argon2id + AES-GCM)
 * and never to SQLite.
 *
 * Key naming comes from the credential boundary, which is the single place that
 * decides what a key looks like. It has to be, because two things depend on the
 * exact string: a connection that is looking for a secret it once stored, and a
 * cleanup that removes the *previous* version's keys after a successful save. A
 * second implementation of the naming would drift and the cleanup would delete the
 * wrong generation.
 */

import { vaultKey } from './credential-boundary'
import type {
  CredentialKind,
  CredentialResource,
  SecretProvider,
} from './credential-boundary'
import { toVaultCommandError, vaultService } from './vault'

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
  | { ok: false, state: 'uninitialized' | 'locked' | 'unusable' }

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

  /**
   * The `SecretProvider` spelling of `availability`.
   *
   * Same call, named for the interface so the resolver can reach it without
   * knowing which provider it holds.
   */
  availabilityState(): Promise<VaultAvailability> {
    return this.availability()
  }

  async read(
    resource: CredentialResource,
    version: number,
    kind: CredentialKind,
  ): Promise<string | undefined> {
    try {
      return await vaultService.get(vaultKey(resource, version, kind))
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
    resource: CredentialResource,
    version: number,
    kind: CredentialKind,
    value: string,
  ): Promise<void> {
    await vaultService.set(vaultKey(resource, version, kind), value)
  }

  async remove(
    resource: CredentialResource,
    version: number,
    kind: CredentialKind,
  ): Promise<void> {
    try {
      await vaultService.delete(vaultKey(resource, version, kind))
    } catch (error) {
      if (toVaultCommandError(error).kind === 'key_not_found') return
      throw error
    }
  }

  /**
   * Remove a whole version of a resource's credentials.
   *
   * Best effort per kind, and it *returns* the kinds it could not remove instead of
   * swallowing them: a failed cleanup leaves orphaned ciphertext, which is a
   * warning worth recording, while the row already points at the new version and
   * must not be reported as failed for it.
   */
  async removeVersion(
    resource: CredentialResource,
    version: number,
    kinds: CredentialKind[],
  ): Promise<CredentialKind[]> {
    const failed: CredentialKind[] = []
    for (const kind of kinds) {
      try {
        await this.remove(resource, version, kind)
      } catch {
        failed.push(kind)
      }
    }
    return failed
  }
}

export const vaultSecretProvider = new VaultSecretProvider()
