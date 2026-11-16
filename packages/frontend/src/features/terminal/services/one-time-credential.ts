/**
 * Connecting once without storing anything.
 *
 * ## What this is for
 *
 * The rule the design sets is that `Authenticate` is not `Save`
 * (`05-ux2-credentials.md` §2): a user must be able to open a session with a
 * password they typed and not have it written anywhere, and a *failed*
 * authentication must never persist anything. Before this there was no way to do
 * either from the UI — a remote tab resolved its credential from the host row's
 * `credentialRef`, so the only connectable hosts were ones that already had a
 * stored secret, and the only way to get one was to save it.
 *
 * ## Why the secret rides on a process-local profile, not on the tab
 *
 * `Tab.profileId` is documented as "process-local profile reference. Credentials
 * never belong in a tab", and `registerTemporaryTerminalProfile` already keeps a
 * `Host` in a module-level map that `TerminalContainer` prefers over the saved row.
 * So a one-time secret reaches the connection path through the machinery that
 * exists, with three properties worth stating:
 *
 * - nothing is written to SQLite, the vault, `localStorage` or the Zustand store;
 * - the secret lives in the same map that already holds temporary profiles, and
 *   dies with it (or when the tab closes and the profile is released);
 * - a *retry* reuses the same profile, so a reconnect does not ask again and does
 *   not need the value re-typed.
 *
 * ## What it deliberately does not do
 *
 * It does not save on success. The design asks for a separate, explicit save after
 * a successful authentication, and that is a different action with its own
 * confirmation — folding it in here would be exactly the "提交表单暗示已保存"
 * behaviour the spec calls out.
 */

import type { Host } from '@/types'
import { registerTemporaryTerminalProfile } from './temporary-terminal-profiles'

/** The secret half a one-time connection may carry. */
export interface OneTimeSecret {
  password?: string
  privateKey?: string
  /** The vault passphrase for `privateKey`, not an account password. */
  passphrase?: string
}

/**
 * Is this host connectable without asking for anything?
 *
 * A host with a readable reference resolves from its provider. A host with inline
 * secrets (only possible for a host object built in this process) is usable as-is.
 * A damaged reference is *not* connectable — it has to be repaired or cleared —
 * and neither is an imported host whose key was never bound.
 *
 * This is the predicate the dialog uses to decide whether it is needed at all, so
 * it has to agree with `withResolvedCredential` rather than being a friendlier
 * approximation of it.
 */
export function needsOneTimeCredential(host: Host): boolean {
  if (host.authType === 'agent') return false
  if (host.password || host.privateKey) return false
  if (host.credentialRefProblem) return false
  if (host.identityFilePath && !host.privateKey) return false
  return (host.credentialRef?.kinds.length ?? 0) === 0
}

/**
 * Why this host cannot be connected by typing a secret, if that is the case.
 *
 * A one-time password cannot fix a damaged reference: the connection path refuses
 * before it looks at any inline secret, so offering a password field would be a
 * form that always fails. The user has to clear or re-bind the reference first,
 * which the host dialog now supports.
 */
export function oneTimeCredentialBlocker(host: Host): string | null {
  if (host.authType === 'agent') return null
  if (host.credentialRefProblem) {
    return 'This host stores a credential this build cannot read. Clear or re-save it in the host dialog before connecting.'
  }
  if (host.identityFilePath && !host.privateKey) {
    return 'This host was imported with a key file that has not been bound. Paste the key or use the SSH agent.'
  }
  return null
}

/**
 * Build the process-local host a one-time connection runs against.
 *
 * Returns the profile id to put on the tab. The original `host` is not mutated and
 * is not put in the map: the map holds a *copy* carrying the secret, so nothing
 * that reads the saved row can ever see it.
 *
 * `passphrase` maps onto `password` only for key/cert authentication, which is
 * what the launcher passes as the key's passphrase (`session_create_ssh_key` takes
 * `password` for that). For password authentication the field is the account
 * password. Keeping one field would conflate the two — the defect recorded in
 * Phase 10.3 — so the mapping is explicit here and in one place.
 */
export function registerOneTimeProfile(host: Host, secret: OneTimeSecret): string {
  const profile: Host = {
    ...host,
    // A profile carries no persisted reference: the whole point is that this
    // connection does not read, write or point at a stored secret.
    credentialRef: null,
    credentialRefProblem: null,
    ...(secret.password === undefined ? {} : { password: secret.password }),
    ...(secret.privateKey === undefined ? {} : { privateKey: secret.privateKey }),
  }
  if (secret.passphrase !== undefined && secret.password === undefined) {
    profile.password = secret.passphrase
  }
  return registerTemporaryTerminalProfile(profile)
}
