/**
 * Moving an ssh key's secret material into the vault.
 *
 * Its own module for the same reason hosts have one: the SQL and the credential
 * lifecycle are separate concerns, coupled by exactly one ordering contract — the
 * row's UPDATE runs between the write and the retire, never the other way round.
 *
 * ## Why the un-retyped half is copied forward
 *
 * An edit form starts empty for the secret fields (their values are live in the
 * vault), so "the user retyped the private key" and "the user left the passphrase
 * alone" are different facts. Writing only what was retyped and then deleting the
 * whole old version loses the passphrase permanently, while the reference still
 * lists it — a row that claims a secret the vault does not hold, which every read
 * reports as "the vault holds none" with nothing left to recover from.
 *
 * So a partial edit copies the untouched kinds into the new generation. If the old
 * generation does not actually hold one of them, the edit fails and the old
 * generation stays intact rather than carrying a hole forward.
 */

import {
  parseCredentialRef,
  refVersion,
  serializeCredentialRef,
} from '@/service/credential-boundary'
import type { CredentialKind, CredentialRef } from '@/service/credential-boundary'
import { vaultSecretProvider } from '@/service/vault-secret-provider'
import { vaultUnavailableMessage } from '@/service/vault-unavailable-message'

/** The reference stored on a key row, read the same way hosts read theirs. */
export function readKeyCredentialRef(
  raw: string | null | undefined,
): CredentialRef | null {
  const parsed = parseCredentialRef(raw)
  return parsed.ok ? parsed.ref : null
}

/** The generation after the one the row points at. Never the same number. */
export function nextKeyVersion(current: CredentialRef | null): number {
  if (current === null) return 1
  return refVersion(current) + 1
}

export interface PersistedKeySecrets {
  ref: CredentialRef | null
  /** The reference the row pointed at before this write, if any. */
  previous: CredentialRef | null
}

export async function persistKeySecrets(
  id: string,
  secrets: { privateKey?: string | null, passphrase?: string | null },
  current: CredentialRef | null,
): Promise<PersistedKeySecrets> {
  const supplied: Array<[CredentialKind, string]> = []
  if (secrets.privateKey) supplied.push(['privateKey', secrets.privateKey])
  if (secrets.passphrase) supplied.push(['passphrase', secrets.passphrase])
  if (supplied.length === 0 && current === null) {
    return { ref: current, previous: null }
  }

  const availability = await vaultSecretProvider.availability()
  if (!availability.ok) {
    throw new Error(vaultUnavailableMessage(availability.state))
  }

  const version = nextKeyVersion(current)
  const resource = { type: 'ssh-key' as const, id }
  const written: CredentialKind[] = []
  const carried: CredentialKind[] = []
  try {
    const suppliedKinds = new Set(supplied.map(([kind]) => kind))
    for (const kind of current?.kinds ?? []) {
      if (suppliedKinds.has(kind)) continue
      const value = await vaultSecretProvider.read(
        resource,
        refVersion(current!),
        kind,
      )
      if (value === undefined) {
        // The old generation promised it and does not hold it. Carrying a hole
        // forward would make the new version claim a secret it never had; failing
        // leaves the old generation intact and the user re-enters the value.
        throw new Error(
          `the vault does not hold the ${kind} this key recorded, so it was not updated`,
        )
      }
      await vaultSecretProvider.write(resource, version, kind, value)
      carried.push(kind)
    }
    for (const [kind, value] of supplied) {
      await vaultSecretProvider.write(resource, version, kind, value)
      written.push(kind)
    }
    for (const [kind, value] of supplied) {
      const readBack = await vaultSecretProvider.read(resource, version, kind)
      if (readBack !== value) {
        throw new Error(`the vault did not return the ${kind} it was just given`)
      }
    }
  } catch (error) {
    await vaultSecretProvider.removeVersion(resource, version, [
      ...written,
      ...carried,
    ])
    throw error
  }

  // The reference lists exactly the kinds this generation holds — no more.
  return {
    ref: { kinds: [...written, ...carried], provider: 'vault', version },
    previous: current,
  }
}

/**
 * Retire a key's previous version after the row stopped pointing at it.
 *
 * A failure here leaves orphaned ciphertext nothing references — wasteful, but not a
 * credential the user lost — so it is swallowed and the caller proceeds. Throwing
 * would tell the user the save failed when it did not.
 */
export async function retireKeyVersion(
  id: string,
  previous: CredentialRef | null,
): Promise<void> {
  if (!previous) return
  try {
    await vaultSecretProvider.removeVersion(
      { type: 'ssh-key', id },
      refVersion(previous),
      previous.kinds,
    )
  } catch {
    // Orphaned data, not a broken credential.
  }
}

/** Remove a generation this attempt wrote but no row points at. */
export async function discardKeyVersion(
  id: string,
  ref: CredentialRef,
): Promise<void> {
  if (ref.version === undefined) return
  try {
    await vaultSecretProvider.removeVersion(
      { type: 'ssh-key', id },
      ref.version,
      ref.kinds,
    )
  } catch {
    // Best effort; the caller is already handling a failure.
  }
}

export { serializeCredentialRef }
