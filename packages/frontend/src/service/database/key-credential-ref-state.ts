/** RC04 — the three states of an SSH key's `credential_ref`, kept separate. */
import { parseCredentialRef } from '@/service/credential-boundary'
import type { CredentialRef } from '@/service/credential-boundary'
import type { CredentialRefProblem } from '@/service/credential-ref'

/**
 * The three states a `credential_ref` column can be in.
 *
 * `parseCredentialRef` has always returned them; this path used to flatten them back to
 * two. The flattening is dangerous in exactly one direction — a **damaged** reference
 * read as **absent** — because "this key stores nothing" is a legal state the product
 * acts on:
 *
 * - `getSSHKeyCredentials` returns `{}` → the connection authenticates with no key;
 * - `updateSSHKey` computes `nextKeyVersion(null) === 1` → the save **overwrites version
 *   1**, which may be the only generation the user could still recover by hand;
 * - clear/delete skip retirement → ciphertext is silently left behind.
 *
 * RC04 measured all three. Keeping the third state visible is the fix; the callers
 * decide, and none of them may treat damage as absence.
 */
export type KeyCredentialRefState =
  | { state: 'ABSENT'; ref: null; problem: null }
  | { state: 'VALID'; ref: CredentialRef; problem: null }
  | { state: 'CORRUPT_OR_UNSUPPORTED'; ref: null; problem: CredentialRefProblem }

/**
 * Read a key row's reference **without collapsing the damaged state**.
 *
 * Callers that must not overwrite or misreport (update, get-secret, clear, delete) use
 * this; `readKeyCredentialRef` remains for the places that genuinely only ask "is there
 * a usable reference", and is implemented in terms of this so the two cannot disagree.
 */
export function readKeyCredentialRefState(
  raw: string | null | undefined,
): KeyCredentialRefState {
  const parsed = parseCredentialRef(raw)
  if (!parsed.ok) {
    return { state: 'CORRUPT_OR_UNSUPPORTED', ref: null, problem: parsed.problem }
  }
  if (parsed.ref === null) return { state: 'ABSENT', ref: null, problem: null }
  return { state: 'VALID', ref: parsed.ref, problem: null }
}

/**
 * The reference stored on a key row, or `null` when there is none **or** it cannot be
 * read.
 *
 * Prefer `readKeyCredentialRefState` anywhere the difference matters. This exists because
 * several call sites only branch on "is there something to follow", and rewriting them to
 * a three-way switch would add a branch that does nothing. Each remaining caller is
 * listed here so that adding one is a reviewable act:
 *
 *   - `ssh-keys.ts` create guard — a brand-new key has no reference at all;
 *   - `ssh-keys.ts` clear — retires what it can and is documented to tolerate damage.
 *
 * Everything else must use the state form.
 */
export function readKeyCredentialRef(
  raw: string | null | undefined,
): CredentialRef | null {
  return readKeyCredentialRefState(raw).ref
}

/**
 * The error a caller gets when a key row names a credential this build cannot read.
 *
 * Carries `kind: 'credential-corrupt-reference'` — the same structured reason the host
 * path reports — so the UI can offer "the stored credential cannot be read" instead of
 * a generic failure, and so a caller can branch without matching on prose.
 *
 * The message never contains the reference itself or any secret material: it is the
 * provider and the problem class only.
 */
export function credentialRefUnreadable(
  what: string,
  id: string,
  problem: CredentialRefProblem | null,
): Error & { kind: 'credential-corrupt-reference'; detail: string } {
  const detail = problem
    ? problem.kind === 'malformed'
      ? problem.detail
      : `${problem.kind}${'provider' in problem ? `: ${problem.provider}` : ''}${
          'version' in problem ? `: v${problem.version}` : ''
        }`
    : 'unknown'
  const error = new Error(
    `${what} ${id} names a credential this build cannot read (${detail}). ` +
      `The stored reference was left untouched so it can still be recovered.`,
  ) as Error & { kind: 'credential-corrupt-reference'; detail: string }
  error.kind = 'credential-corrupt-reference'
  error.detail = detail
  return error
}
