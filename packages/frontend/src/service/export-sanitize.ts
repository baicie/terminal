/**
 * Field whitelists for the plain JSON export.
 *
 * The export used to be `SELECT *` + `JSON.stringify`, so any secret column - and
 * any secret column added later - went straight into the file. A whitelist is the
 * only form that stays safe when the schema grows: an unknown column is simply not
 * copied, instead of being copied and then hopefully redacted.
 *
 * What is kept is what a restore needs: identity, addressing, groupings and the
 * *reference* to a credential. What is dropped is anything that would let the file
 * authenticate on its own.
 */

import { parseCredentialRef } from './credential-ref'
import type { CredentialRef } from './credential-boundary'

/** A host as it appears in an export: metadata and a credential pointer only. */
export interface ExportedHost {
  id: string
  name: string
  hostname: string
  port: number
  username: string
  auth_type: string
  /** Public material; a certificate identifies, it does not authenticate. */
  certificate: string | null
  group_id: string | null
  is_favorite: number
  color: string | null
  tags: string | null
  port_forwards: string | null
  startup_command: string | null
  environment: string | null
  jump_host_id: string | null
  jump_host_auth_type: string | null
  agent_forwarding: number
  shell_integration: string | null
  created_at: number
  updated_at: number
  /**
   * Which secrets the source device had stored, and where. It is deliberately a
   * description, not a value: the vault is per-device, so the target must rebind
   * the secret itself. See docs/phase10/08-credential-single-write-path-adr.md §6.
   */
  credential_ref: CredentialRef | null
}

const HOST_FIELDS = [
  'id',
  'name',
  'hostname',
  'port',
  'username',
  'auth_type',
  'certificate',
  'group_id',
  'is_favorite',
  'color',
  'tags',
  'port_forwards',
  'startup_command',
  'environment',
  'jump_host_id',
  'jump_host_auth_type',
  'agent_forwarding',
  'shell_integration',
  'created_at',
  'updated_at',
] as const

/** Columns that must never reach an export, listed so a reviewer can see them. */
export const HOST_SECRET_FIELDS = ['password', 'private_key', 'passphrase'] as const
export const SSH_KEY_SECRET_FIELDS = ['private_key', 'passphrase'] as const

/**
 * The reference to write into an export, or `null` when the host stores none.
 *
 * Uses the same parser as the read path — one implementation, so the file can never
 * describe a reference this build would not accept.
 *
 * ## Why an unreadable reference stops the export
 *
 * This used to write `null` and continue, on the argument that "the honest
 * description of 'unreadable' is 'not something the target can rebind from'". That
 * is true about rebinding and false about the file: after export → import the
 * target cannot distinguish "this host never stored a credential" from "this host
 * stored one the exporting build could not read". The first is a fact the user can
 * act on; the second is a defect, and a backup that hides it is worse than no
 * backup — the user restores it believing the file is complete.
 *
 * So a reference that exists but does not parse aborts the export and names the
 * row. `null` is reserved for the one case where it is true: nothing was stored.
 */
export class ExportIntegrityError extends Error {
  constructor(
    readonly hostId: string,
    readonly reason: string,
    readonly kind: 'host' | 'ssh-key',
    /** For an unknown provider, which one. It is a name, not a secret. */
    readonly provider?: string,
  ) {
    // `reason` is the parser's own problem kind, never the reference text: the
    // column holds metadata today, and echoing raw JSON into an error message is
    // how a future field becomes a leak.
    super(
      `The ${kind} "${hostId}" has a stored credential this build cannot read ` +
        `(${provider === undefined ? reason : `${reason}: ${provider}`}). ` +
        'Export aborted so the backup does not describe the host as having no ' +
        'credential. Re-save that credential, or remove it, then export again.',
    )
    this.name = 'ExportIntegrityError'
  }
}

function readRef(
  raw: unknown,
  id: string,
  kind: 'host' | 'ssh-key',
): CredentialRef | null {
  // Absent means nothing was stored. That is a fact, and it exports as `null`.
  if (raw === null || raw === undefined || raw === '') return null
  const parsed = parseCredentialRef(raw)
  if (!parsed.ok) {
    const problem = parsed.problem
    throw new ExportIntegrityError(
      id,
      problem.kind,
      kind,
      problem.kind === 'unknown-provider' ? problem.provider : undefined,
    )
  }
  return parsed.ref
}

export function sanitizeHostRow(row: Record<string, unknown>): ExportedHost {
  const out = {} as Record<string, unknown>
  for (const field of HOST_FIELDS) {
    // `undefined` becomes `null` so the file's shape stays stable across rows.
    out[field] = row[field] ?? null
  }
  out.credential_ref = readRef(row.credential_ref, String(out.id), 'host')
  return out as unknown as ExportedHost
}

/** An ssh key in an export: identity and public half, never the private half. */
export interface ExportedSshKey {
  id: string
  name: string
  key_type: string | null
  public_key: string | null
  certificate: string | null
  is_encrypted: number | null
  created_at: number | null
  updated_at: number | null
  /**
   * Which secret this key stored, and where — same rule as `ExportedHost`.
   *
   * This field used to be absent entirely, so every exported key described itself
   * as having no stored private material even when it had one. The target then
   * imported a key that could never authenticate and nothing said why.
   */
  credential_ref: CredentialRef | null
}

const SSH_KEY_FIELDS = [
  'id',
  'name',
  'key_type',
  'public_key',
  'certificate',
  'is_encrypted',
  'created_at',
  'updated_at',
] as const

export function sanitizeSshKeyRow(row: Record<string, unknown>): ExportedSshKey {
  const out = {} as Record<string, unknown>
  for (const field of SSH_KEY_FIELDS) {
    out[field] = row[field] ?? null
  }
  out.credential_ref = readRef(
    row.credential_ref,
    String(out.id),
    'ssh-key',
  )
  return out as unknown as ExportedSshKey
}

/**
 * True when a string still looks like secret material.
 *
 * Used only by the export path's own test as a backstop: if a future whitelist
 * accidentally includes a secret column, the test fails even when nobody updated
 * the list of forbidden field names.
 */
export function looksLikeSecretMaterial(value: string): boolean {
  return (
    value.includes('BEGIN OPENSSH PRIVATE KEY')
    || value.includes('BEGIN RSA PRIVATE KEY')
    || value.includes('BEGIN PRIVATE KEY')
  )
}
