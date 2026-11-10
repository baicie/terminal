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
 * The reference to write into an export, or `null` when there is none to describe.
 *
 * Uses the same parser as the read path — one implementation, so the file can never
 * describe a reference this build would not accept. The previous local copy dropped
 * `version`, which meant a re-imported backup described a credential that had no
 * generation, and it flattened a *damaged* reference to `null`, which told the user
 * the source device had stored nothing when in fact it had something unreadable.
 *
 * A damaged reference is exported as `null` rather than as a claim: the file is a
 * description, and the honest description of "unreadable" is "not something the
 * target can rebind from". The host still imports; the user simply re-sets the
 * credential, which is what they would have had to do anyway.
 */
function parseRef(raw: unknown): CredentialRef | null {
  const parsed = parseCredentialRef(raw)
  return parsed.ok ? parsed.ref : null
}

export function sanitizeHostRow(row: Record<string, unknown>): ExportedHost {
  const out = {} as Record<string, unknown>
  for (const field of HOST_FIELDS) {
    // `undefined` becomes `null` so the file's shape stays stable across rows.
    out[field] = row[field] ?? null
  }
  out.credential_ref = parseRef(row.credential_ref)
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
