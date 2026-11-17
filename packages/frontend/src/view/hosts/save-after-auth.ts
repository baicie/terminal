/**
 * Saving a one-time credential *after* it has been proven to work.
 *
 * ## The rule this implements
 *
 * `Authenticate` is not `Save` (`05-ux2-credentials.md` §2). The connect-time dialog
 * deliberately has no "remember this" checkbox, because a checkbox beside a password
 * field reads as "this will be stored" before anything has validated it. The save is a
 * separate act, offered only once, and only after a session actually came up.
 *
 * ## Why the decision is a pure function
 *
 * Whether a save may be offered is the part that goes wrong quietly. If the prompt
 * appears for a rejected password, the app stores a credential the user was just told
 * does not work — and the next connection fails for a reason nobody can explain. That
 * decision is small enough to test exhaustively, so it lives here rather than inline in
 * a component where it would only be exercised through the UI.
 *
 * ## Why the write goes through `updateHost`
 *
 * A second write path is how a damaged reference gets silently overwritten (the
 * Phase 10.1.1 defect: the mapper reports `credentialRef: null` *plus*
 * `credentialRefProblem`, and a writer that only looks at the first picks version 1).
 * `updateHost` already refuses to write secrets onto a damaged reference and already
 * knows how an auth-type switch changes which kinds still apply. Saving a secret is an
 * ordinary host update, so it is one.
 */

import type { Host } from '@/types'
import type { OneTimeSecret } from '@/features/terminal/services/one-time-credential'

/** The write the save performs. Injected so a test does not need SQLite. */
export type HostUpdater = (id: string, updates: Partial<Host>) => Promise<void>

export interface SaveOfferInput {
  /** Did a session actually come up? Not "was a tab created". */
  connected: boolean
  /** What the user typed. Null when the connect path resolved a stored credential. */
  secret: OneTimeSecret | null
  host: Host
}

/**
 * May the user be asked whether to store this secret?
 *
 * Four conditions, all necessary:
 *
 * - the connection succeeded — otherwise the credential is unproven;
 * - there is a secret in hand — a stored credential needs no save prompt, and one
 *   resolved from the vault is already saved;
 * - the secret is non-empty — an empty object means the dialog produced nothing;
 * - the host does not use an agent — an agent login holds no secret in this process,
 *   so "save this" would be asking about something the app never had.
 */
export function canOfferSaveAfterAuth(input: SaveOfferInput): boolean {
  if (!input.connected) return false
  if (input.host.authType === 'agent') return false
  const secret = input.secret
  if (!secret) return false
  return Boolean(secret.password || secret.privateKey || secret.passphrase)
}

/**
 * Map a stored secret onto the fields `updateHost` takes.
 *
 * `passphrase` goes to `password` for key authentication because that is the field the
 * SSH layer reads the key's passphrase from (`session_create_ssh_key` takes `password`
 * for it) — the same mapping `registerOneTimeProfile` makes for the connection itself.
 * Keeping the two consistent is what makes "connect then save" store exactly the value
 * that proved it works.
 */
function updatesFor(secret: OneTimeSecret): Partial<Host> {
  const updates: Partial<Host> = {}
  if (secret.password !== undefined) updates.password = secret.password
  if (secret.privateKey !== undefined) updates.privateKey = secret.privateKey
  if (secret.passphrase !== undefined && secret.password === undefined) {
    updates.password = secret.passphrase
  }
  // Nothing else: a save must not rewrite the name, group, tags or any unrelated
  // column. `updateHost` merges onto the stored row, so an omitted field stays as it
  // is — which is the behaviour a prompt that asks about *one secret* should have.
  return updates
}

export type SaveResult = { ok: true } | { ok: false, message: string }

/**
 * Store the secret that just authenticated successfully.
 *
 * A failure here must not be reported as success: a prompt that closes as though it
 * saved leaves the user believing the password is stored, and the next connection asks
 * again for no visible reason. The connection itself is unaffected either way — it is
 * already up, and this only writes.
 */
export async function saveOneTimeSecretForHost(
  input: { host: Host, secret: OneTimeSecret },
  deps: { updateHost: HostUpdater },
): Promise<SaveResult> {
  const updates = updatesFor(input.secret)
  if (Object.keys(updates).length === 0) {
    // Nothing to write. Reported as success because there is nothing the user is
    // waiting on — but this never reaches the UI, because `canOfferSaveAfterAuth`
    // filters the case first.
    return { ok: true }
  }
  try {
    await deps.updateHost(input.host.id, updates)
    return { ok: true }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, message: describeSaveFailure(reason) }
  }
}

/**
 * Turn a write failure into the action that fixes it.
 *
 * A locked vault and an uninitialised one need different things from the user, and
 * "save failed" names neither. Anything unrecognised is passed through unchanged
 * rather than guessed at — inventing a cause is how a real error gets hidden.
 */
export function describeSaveFailure(reason: string): string {
  if (/locked/i.test(reason)) {
    return 'The vault is locked. Unlock it, then save again.'
  }
  if (/not initialized|uninitialized|no vault/i.test(reason)) {
    return 'No vault exists yet. Create one, then save again.'
  }
  return reason
}
