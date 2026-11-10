/**
 * Reading a host's real secrets for one explicit share operation.
 *
 * ## Why this exists
 *
 * The share dialog used to read `host.password` / `host.privateKey`. Since
 * Phase 10.1 those fields are *always* undefined on a saved host — the secret is
 * in the vault and the row carries only `credentialRef`. Both guards were
 * therefore permanently false: ticking "include password" shared nothing at all
 * and still showed a success toast. The teammate received a host with no
 * credential and no hint that one was intended.
 *
 * ## The rules this module enforces
 *
 * 1. Values come from the vault, through the reference the row already carries.
 * 2. A damaged or absent reference is a failure, not "no secret": the caller has
 *    to be able to tell the two apart to say anything true to the user.
 * 3. A locked vault is a failure. Falling back to "share without the secret"
 *    would reproduce the original defect in a different disguise.
 * 4. Nothing here logs, throws with a value, or returns a value on failure.
 */

import { refVersion } from '@/service/credential-boundary'
import type {
  CredentialKind,
  CredentialRef,
} from '@/service/credential-boundary'
import { vaultSecretProvider } from '@/service/vault-secret-provider'
import { vaultUnavailableMessage } from '@/service/vault-unavailable-message'

export interface HostShareSecrets {
  password?: string
  privateKey?: string
  passphrase?: string
}

export type ReadShareSecretsResult =
  | { ok: true; secrets: HostShareSecrets }
  | { ok: false; message: string }

/**
 * Read the kinds a share needs from the vault.
 *
 * Only the kinds present in the reference are read — a host that stores a
 * password has no key to read, and asking for one would report a failure for a
 * secret that was never there.
 */
export async function readHostSecretsForShare(
  hostId: string,
  reference: CredentialRef | null,
  kinds: CredentialKind[],
): Promise<ReadShareSecretsResult> {
  if (kinds.length === 0) return { ok: true, secrets: {} }

  if (reference === null || reference.kinds.length === 0) {
    return {
      ok: false,
      message:
        'This host stores no credential, so there is nothing to share. Share it without credentials, or save a password or key first.',
    }
  }

  // A kind the reference does not list cannot be read: the row never claimed to
  // hold it. Asking anyway would turn "you do not have this" into "the vault is
  // broken", which is a misleading answer.
  const missing = kinds.filter(kind => !reference.kinds.includes(kind))
  if (missing.length > 0) {
    return {
      ok: false,
      message: `This host has no stored ${missing.join(' or ')}, so it cannot be shared with credentials.`,
    }
  }

  const availability = await vaultSecretProvider.availability()
  if (!availability.ok) {
    return { ok: false, message: vaultUnavailableMessage(availability.state) }
  }

  const version = refVersion(reference)
  const resource = { type: 'host' as const, id: hostId }
  const secrets: HostShareSecrets = {}

  for (const kind of kinds) {
    let value: string | undefined
    try {
      value = await vaultSecretProvider.read(resource, version, kind)
    } catch (error) {
      // A read that throws is not "absent": a locked vault or a failed decrypt
      // must not be reported as an empty secret.
      return {
        ok: false,
        message: `The ${kind} could not be read from the vault (${
          error instanceof Error ? error.message : String(error)
        }).`,
      }
    }
    if (value === undefined) {
      // The reference promised it and the vault does not hold it. Sharing the
      // rest would hand the recipient a host that silently fails to connect.
      return {
        ok: false,
        message: `The vault does not hold the ${kind} this host records, so nothing was shared.`,
      }
    }
    if (kind === 'password') secrets.password = value
    else if (kind === 'privateKey') secrets.privateKey = value
    else secrets.passphrase = value
  }

  return { ok: true, secrets }
}

/** The kinds a share needs, given what the user asked to include. */
export function shareKindsFor(
  reference: CredentialRef | null,
  includeCredentials: boolean,
): CredentialKind[] {
  if (!includeCredentials) return []
  return reference?.kinds ?? []
}
