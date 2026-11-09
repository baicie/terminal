/**
 * Reading the `credential_ref` column.
 *
 * Its own module because "what does this pointer mean" is a different question from
 * "how do I resolve a connection", and because the answer has three outcomes, not
 * two — a distinction the whole security boundary depends on:
 *
 * - empty: this host stores nothing (agent auth, or a prompt at connect time);
 * - usable: a reference this build can follow;
 * - damaged: something is stored and this build cannot name it.
 *
 * Collapsing the third into the first is how a corrupt pointer becomes an empty
 * password and a login failure that describes nothing.
 */

import type { CredentialKind, CredentialRef } from './credential-boundary'

/**
 * Why a stored reference could not be used.
 *
 * These are *different states*, and collapsing them is how a broken pointer gets
 * read as "this host stores nothing" — after which the connection goes out with an
 * empty password and the user sees an authentication failure instead of the real
 * problem. See `docs/phase10/10-credential-boundary-adr.md` §4.
 */
export type CredentialRefProblem =
  /** A provider this build does not have. Not a credential, not "nothing". */
  | { kind: 'unknown-provider', provider: string }
  /** A version this build does not understand (written by a newer build). */
  | { kind: 'unsupported-version', version: number }
  /** Valid JSON, but not a credential reference. */
  | { kind: 'malformed', detail: string }
  /** The kinds list is empty although a reference exists. */
  | { kind: 'empty-kinds' }

export type CredentialRefParse =
  | { ok: true; ref: CredentialRef | null, problem: null }
  | { ok: false; ref: null, problem: CredentialRefProblem }

/**
 * Parse the `credential_ref` column.
 *
 * Returns three outcomes rather than two, because "no credential" and "a credential
 * I cannot read" must not be the same value:
 *
 * - `ok: true, ref: null` — the column is empty. The host stores nothing.
 * - `ok: true, ref: …` — a usable reference.
 * - `ok: false, problem: …` — something is there and it is not usable. The caller
 *   must surface this; connecting with an empty password would hide it.
 *
 * A reference written by a *newer* build (a version above `MAX_SUPPORTED_VERSION`)
 * is refused rather than guessed at: reading it with the wrong key layout would
 * report "the vault holds none", which reads as data loss.
 */
export const MAX_SUPPORTED_VERSION = Number.MAX_SAFE_INTEGER

export function parseCredentialRef(raw: unknown): CredentialRefParse {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, ref: null, problem: null }
  }
  let parsed: unknown
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return {
        ok: false,
        ref: null,
        problem: { kind: 'malformed', detail: 'the stored reference is not valid JSON' },
      }
    }
  } else {
    parsed = raw
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      ref: null,
      problem: { kind: 'malformed', detail: 'the stored reference is not an object' },
    }
  }
  const record = parsed as {
    kinds?: unknown
    provider?: unknown
    version?: unknown
  }
  if (typeof record.provider !== 'string' || record.provider === '') {
    return {
      ok: false,
      ref: null,
      problem: { kind: 'malformed', detail: 'the stored reference names no provider' },
    }
  }
  if (record.provider !== 'vault') {
    // Not an error in the data: this build simply has no such backend. It is still
    // a credential the user stored, so it must not read as "nothing stored".
    return {
      ok: false,
      ref: null,
      problem: { kind: 'unknown-provider', provider: record.provider },
    }
  }
  if (!Array.isArray(record.kinds)) {
    return {
      ok: false,
      ref: null,
      problem: { kind: 'malformed', detail: 'the stored reference has no kinds list' },
    }
  }
  const kinds = record.kinds.filter(
    (kind): kind is CredentialKind =>
      kind === 'password' || kind === 'privateKey' || kind === 'passphrase',
  )
  if (kinds.length !== record.kinds.length) {
    return {
      ok: false,
      ref: null,
      problem: { kind: 'malformed', detail: 'the stored reference names an unknown kind' },
    }
  }
  if (kinds.length === 0) {
    // An empty reference is a contradictory record: it claims a stored credential
    // and names none. Treating it as "nothing" would hide a write bug.
    return { ok: false, ref: null, problem: { kind: 'empty-kinds' } }
  }
  if (record.version === undefined || record.version === null) {
    // A reference from before versions existed. Its secrets are under the
    // unversioned keys, and `LEGACY_VERSION` is how every reader finds them.
    return { ok: true, ref: { kinds, provider: 'vault' }, problem: null }
  }
  if (
    typeof record.version !== 'number'
    || !Number.isSafeInteger(record.version)
    || record.version < 0
  ) {
    return {
      ok: false,
      ref: null,
      problem: { kind: 'malformed', detail: 'the stored reference has an invalid version' },
    }
  }
  if (record.version > MAX_SUPPORTED_VERSION) {
    return {
      ok: false,
      ref: null,
      problem: { kind: 'unsupported-version', version: record.version },
    }
  }
  return { ok: true, ref: { kinds, provider: 'vault', version: record.version }, problem: null }
}

