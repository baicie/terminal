/**
 * Moving a host's secrets into the vault, and retiring what it replaces.
 *
 * Split out of `hosts.ts` so the SQL and the credential lifecycle can be read
 * separately. The two are coupled by exactly one contract: the row's UPDATE runs
 * between `persistHostSecrets` and `retirePreviousVersion`, and never the other way
 * round.
 *
 * Every function here is about *ordering*, because SQLite and the vault share no
 * transaction. The guarantee is the version number, not atomicity:
 *
 *   - write the new generation first (the row still points at the old one);
 *   - commit the row, which switches the pointer;
 *   - only then remove the old generation.
 *
 * Any crash leaves a complete generation on both sides of the pointer, plus at most
 * some ciphertext nothing references.
 */

import { refVersion, splitHostSecrets } from '@/service/credential-boundary'
import type { CredentialKind, CredentialRef } from '@/service/credential-boundary'
import { vaultSecretProvider } from '@/service/vault-secret-provider'
import { vaultUnavailableMessage } from '@/service/vault-unavailable-message'

/**
 * The version a new write of this resource's credentials will use.
 *
 * Always one above what the row currently points at, never the same number. That
 * is the whole mechanism: a new version cannot overwrite a secret a live row still
 * depends on, so a failure part-way through a two-secret update leaves the old
 * generation intact and usable.
 */
export function nextVersion(current: CredentialRef | null): number {
  if (current === null) return 1
  return refVersion(current) + 1
}

/**
 * The result of moving a host's secrets into the vault.
 *
 * Carries the reference to store and the version it replaced, because the caller
 * that persists the row is also the only one that may retire the old version — and
 * only after the row no longer points at it.
 */
export interface PersistedSecrets {
  ref: CredentialRef | null
  /** The version the row pointed at before this write, if any. */
  previousVersion: number | null
  /** Kinds the previous version held, so cleanup knows what to remove. */
  previousKinds: CredentialKind[]
}

/**
 * Persist a host's secrets to the vault and return the reference to store on the
 * row.
 *
 * The row must never carry the value: `password` and `private_key` are written as
 * NULL unconditionally, and the reference is what tells a later connection where
 * to look. A host with no secrets gets a NULL reference, which is a valid state
 * (agent authentication, or a password asked at connect time).
 *
 * Ordering, and what each failure leaves behind:
 *
 * 1. Fail before touching anything if the vault cannot take the secret. Saying
 *    "saved" while the secret only exists in memory is how a user ends up unable to
 *    reconnect after a restart. The message names the action that actually works:
 *    a fresh install has no vault to unlock, so telling the user to unlock one
 *    sends them in a circle.
 * 2. Write every kind under the *new* version. A failure mid-loop leaves a partial
 *    new generation, which nothing references yet; the caller aborts and the row
 *    still points at the previous, complete version.
 * 3. Read each one back. A write that reported success but did not land would
 *    otherwise be indistinguishable from one that did, and the user would discover
 *    it at connect time.
 */
export async function persistHostSecrets(
  host: {
    id: string
    password?: string | null
    privateKey?: string | null
    passphrase?: string | null
  },
  current: CredentialRef | null,
): Promise<PersistedSecrets> {
  const version = nextVersion(current)
  const { ref, secrets } = splitHostSecrets(host, version)
  const previous: PersistedSecrets = {
    ref,
    previousVersion: current === null ? null : refVersion(current),
    previousKinds: current?.kinds ?? [],
  }
  if (secrets.length === 0) return { ...previous, ref: null }

  const availability = await vaultSecretProvider.availability()
  if (!availability.ok) {
    throw new Error(vaultUnavailableMessage(availability.state))
  }

  const resource = { type: 'host' as const, id: host.id }
  const suppliedKinds = new Set(secrets.map(secret => secret.kind))
  const written: CredentialKind[] = []
  const carried: CredentialKind[] = []

  // The un-retyped half has to come forward with the half that was retyped.
  //
  // The edit dialog starts empty for every secret field — the values live in the
  // vault and the columns are NULL — so "the user retyped the password" and "the
  // user left the key alone" arrive as different facts on the same call. Building
  // the new reference from the submitted fields alone lists only `password`, and
  // `retirePreviousVersion` then removes the whole old generation, private key
  // included. That is the same loss `persistKeySecrets` already guards against;
  // this path had no equivalent because its only multi-secret test wrote both
  // secrets at once.
  //
  // If the old generation does not actually hold a kind its reference promised,
  // the update fails rather than carrying a hole forward: a reference that names a
  // secret the vault cannot deliver reads as "nothing stored" at connect time,
  // with nothing left to recover from.
  const kinds = [...suppliedKinds, ...(current?.kinds ?? [])].filter(
    (kind, index, all) => all.indexOf(kind) === index,
  )

  // What each kind under the new version must read back as. Carried kinds are
  // captured while copying, so the verification below does not go back to the old
  // generation — by then the caller may already have replaced it.
  const expected = new Map<CredentialKind, string>()

  try {
    for (const kind of kinds) {
      if (suppliedKinds.has(kind)) continue
      const value = await vaultSecretProvider.read(
        resource,
        refVersion(current!),
        kind,
      )
      if (value === undefined) {
        throw new Error(
          `the vault does not hold the ${kind} this host recorded, so it was not updated`,
        )
      }
      await vaultSecretProvider.write(resource, version, kind, value)
      expected.set(kind, value)
      carried.push(kind)
    }
    for (const secret of secrets) {
      await vaultSecretProvider.write(resource, version, secret.kind, secret.value)
      expected.set(secret.kind, secret.value)
      written.push(secret.kind)
    }
    // Read back everything the new reference will name — the carried kinds too,
    // because a reference is a promise and this is the only place that can check
    // it before the row starts pointing at the new version.
    for (const [kind, want] of expected) {
      const readBack = await vaultSecretProvider.read(resource, version, kind)
      if (readBack !== want) {
        throw new Error(
          `the vault did not return the ${kind} it was just given`,
        )
      }
    }
  } catch (error) {
    // Remove what this attempt wrote, so a retry starts clean and a failed save
    // does not accumulate unreachable ciphertext. A cleanup failure is not allowed
    // to mask the original error: the row still points at the old version, so the
    // leftover is orphaned data, not a broken credential.
    await vaultSecretProvider.removeVersion(resource, version, [
      ...written,
      ...carried,
    ])
    throw error
  }

  // The reference lists exactly the kinds the new generation holds — no more.
  return {
    ...previous,
    ref: {
      kinds: [...written, ...carried],
      provider: 'vault',
      version,
    },
  }
}

/**
 * Retire the version a row no longer points at.
 *
 * Called only after the row's UPDATE committed. A failure here leaves orphaned
 * ciphertext that nothing references — wasteful, but not a credential the user
 * lost — so it is reported to the caller rather than thrown: throwing would tell
 * the user the save failed when it did not, and invite a retry that writes another
 * version.
 */
export async function retirePreviousVersion(
  id: string,
  previous: PersistedSecrets,
): Promise<CredentialKind[]> {
  if (previous.previousVersion === null) return []
  try {
    return await vaultSecretProvider.removeVersion(
      { type: 'host', id },
      previous.previousVersion,
      previous.previousKinds,
    )
  } catch {
    // The row already points at the new version, so this is orphaned ciphertext.
    // Reporting it as a failed save would be a lie about the credential that is
    // actually in use, and would invite a retry that writes yet another version.
    // It is returned so the caller can record it.
    return previous.previousKinds
  }
}

