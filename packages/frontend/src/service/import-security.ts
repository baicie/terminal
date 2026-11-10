/**
 * The import security boundary.
 *
 * A backup file can carry plaintext secrets for three reasons: it was made by the
 * Phase 10 build, it was made by a *pre*-Phase 10 build, or somebody built it by
 * hand. The importer cannot tell those apart from the file, and it must not guess:
 *   guessing "old backup, drop the secrets" loses the user's credentials silently;
 *   guessing "keep them" writes plaintext into SQLite, which is the defect this
 *   whole phase exists to close.
 *
 * So the decision is explicit, and it is made on a *plan* the user sees first:
 *
 *   - `diagnose` reads a parsed file and reports what it holds, with no values;
 *   - `prepare` turns that into a payload for one policy, and for `migrate` it is
 *     the step that actually moves the secrets into this device's vault and reads
 *     each one back before the database is touched.
 *
 * Everything here is pure with respect to SQLite: no statement runs in this module.
 * The writer in Rust is the only place a row is written, and it has no secret
 * column. See docs/phase10/10-credential-boundary-adr.md.
 */

import { parseCredentialRef } from './credential-ref'
import type { CredentialKind } from './credential-boundary'

/** What to do with secrets found in an import file. */
export type ImportSecretsPolicy = 'reject' | 'migrate' | 'discard'

/** One secret-bearing row, described without its value. */
export interface ImportSecretRow {
  resource: 'host' | 'sshKey'
  id: string
  name: string
  kinds: CredentialKind[]
}

/** What an import file holds, as a prompt can show it. */
export interface ImportSecretsDiagnosis {
  hosts: number
  sshKeys: number
  /** Per-kind counts, so the prompt can say "3 passwords, 1 private key". */
  counts: {
    hostPasswords: number
    hostPrivateKeys: number
    sshKeyPrivateKeys: number
    sshKeyPassphrases: number
  }
  /** Every row that would need a decision. Contains no secret material. */
  rows: ImportSecretRow[]
  /** Hosts the source device had a stored credential for, that cannot be carried. */
  sourceCredentialRefs: ImportSecretRow[]
  /** True when the file needs a policy before it can be imported at all. */
  needsDecision: boolean
}

type Resource = Record<string, unknown>

function asRows(value: unknown): Resource[] {
  return Array.isArray(value) ? (value as Resource[]) : []
}

/** A field counts as a secret when it is a non-empty string, matching the backend. */
function hasSecret(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Kinds a host row carries.
 *
 * Mirrors `carries_secret` in `src-tauri/src/db_import/secrets.rs`. The two must
 * agree: the backend refuses a payload whose count disagrees with its own, and a
 * frontend that under-counted would present a prompt that hides a credential.
 */
export function hostSecretKinds(row: Resource): CredentialKind[] {
  const kinds: CredentialKind[] = []
  if (hasSecret(row.password)) kinds.push('password')
  if (hasSecret(row.private_key)) kinds.push('privateKey')
  return kinds
}

export function sshKeySecretKinds(row: Resource): CredentialKind[] {
  const kinds: CredentialKind[] = []
  if (hasSecret(row.private_key)) kinds.push('privateKey')
  if (hasSecret(row.passphrase)) kinds.push('passphrase')
  return kinds
}

/**
 * Parse a reference that arrived from a file, for reporting only.
 *
 * One parser with the read path (`credential-ref.ts`), so what an import *describes*
 * and what this build would *accept* cannot drift. The kinds are used to tell the
 * user what the source device had; the reference itself is never persisted.
 */
function sourceRef(raw: unknown): ReturnType<typeof parseCredentialRef> {
  const text =
    typeof raw === 'string' ? raw : raw ? JSON.stringify(raw) : ''
  if (!text) return { ok: true, ref: null, problem: null }
  return parseCredentialRef(text)
}

/**
 * True when the row names a credential the source device stored.
 *
 * A damaged or foreign reference still means "there was a credential": reporting it
 * as absent would import the host as storing nothing, which is the silent downgrade
 * the boundary forbids.
 */
function declaresSourceCredential(row: Resource): boolean {
  const parsed = sourceRef(row.credential_ref)
  if (parsed.ok) return parsed.ref !== null
  return true
}

/**
 * Describe what a parsed file holds.
 *
 * Counts and identities only. A caller can log this, show it, or store it, and no
 * secret is reachable from it — which is what makes the prompt safe to build.
 */
export function diagnoseImport(
  data: { hosts?: unknown, sshKeys?: unknown },
): ImportSecretsDiagnosis {
  const hosts = asRows(data.hosts)
  const sshKeys = asRows(data.sshKeys)

  const counts = {
    hostPasswords: 0,
    hostPrivateKeys: 0,
    sshKeyPrivateKeys: 0,
    sshKeyPassphrases: 0,
  }
  const rows: ImportSecretRow[] = []
  const sourceCredentialRefs: ImportSecretRow[] = []

  let hostRowsWithSecrets = 0
  for (const row of hosts) {
    const kinds = hostSecretKinds(row)
    if (kinds.length > 0) {
      hostRowsWithSecrets += 1
      if (kinds.includes('password')) counts.hostPasswords += 1
      if (kinds.includes('privateKey')) counts.hostPrivateKeys += 1
      rows.push({
        resource: 'host',
        id: text(row.id),
        name: text(row.name),
        kinds,
      })
      continue
    }
    if (!declaresSourceCredential(row)) continue
    // No plaintext, but the file says a credential existed: the target cannot read
    // that vault, so the host needs a rebind and the user must be told.
    sourceCredentialRefs.push({
      resource: 'host',
      id: text(row.id),
      name: text(row.name),
      kinds: sourceRef(row.credential_ref).ref?.kinds ?? [],
    })
  }

  let keyRowsWithSecrets = 0
  for (const row of sshKeys) {
    const kinds = sshKeySecretKinds(row)
    if (kinds.length === 0) continue
    keyRowsWithSecrets += 1
    if (kinds.includes('privateKey')) counts.sshKeyPrivateKeys += 1
    if (kinds.includes('passphrase')) counts.sshKeyPassphrases += 1
    rows.push({
      resource: 'sshKey',
      id: text(row.id),
      name: text(row.name),
      kinds,
    })
  }

  const total =
    counts.hostPasswords +
    counts.hostPrivateKeys +
    counts.sshKeyPrivateKeys +
    counts.sshKeyPassphrases

  return {
    hosts: hostRowsWithSecrets,
    sshKeys: keyRowsWithSecrets,
    counts,
    rows,
    sourceCredentialRefs,
    needsDecision: total > 0,
  }
}

/** Human-readable summary with no secret material in it. */
export function describeImportSecrets(
  diagnosis: ImportSecretsDiagnosis,
): string {
  const { counts } = diagnosis
  const parts: string[] = []
  if (counts.hostPasswords) parts.push(`${counts.hostPasswords} host password(s)`)
  if (counts.hostPrivateKeys) parts.push(`${counts.hostPrivateKeys} host private key(s)`)
  if (counts.sshKeyPrivateKeys) parts.push(`${counts.sshKeyPrivateKeys} ssh key private key(s)`)
  if (counts.sshKeyPassphrases) parts.push(`${counts.sshKeyPassphrases} ssh key passphrase(s)`)
  if (parts.length === 0) return 'The file carries no plaintext secrets.'
  return `The file carries ${parts.join(', ')} in plaintext.`
}
