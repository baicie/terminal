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
import { vaultService } from './vault'

const KEY_PREFIX = 'host'

function vaultKey(hostId: string, kind: CredentialKind): string {
  return `${KEY_PREFIX}:${hostId}:${kind}`
}

export class VaultSecretProvider implements SecretProvider {
  async isAvailable(): Promise<boolean> {
    // A locked vault reports itself as locked; any other failure (no vault file,
    // corrupt file) means the backend cannot serve secrets either.
    try {
      return await vaultService.isUnlocked()
    } catch {
      return false
    }
  }

  async read(hostId: string, kind: CredentialKind): Promise<string | undefined> {
    try {
      return await vaultService.get(vaultKey(hostId, kind))
    } catch (error) {
      // Only "this key does not exist" is absence. A locked vault or a failed
      // decrypt must reach the resolver as an error, not as "no secret".
      const kindOfError = (error as { kind?: string }).kind
      if (kindOfError === 'key_not_found') return undefined
      throw error
    }
  }

  async write(hostId: string, kind: CredentialKind, value: string): Promise<void> {
    await vaultService.set(vaultKey(hostId, kind), value)
  }

  async remove(hostId: string, kind: CredentialKind): Promise<void> {
    try {
      await vaultService.delete(vaultKey(hostId, kind))
    } catch (error) {
      if ((error as { kind?: string }).kind === 'key_not_found') return
      throw error
    }
  }
}

export const vaultSecretProvider = new VaultSecretProvider()
