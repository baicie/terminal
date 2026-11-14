/**
 * Session claims — who is using a session, and which sessions are alive.
 *
 * ## The window claims close
 *
 * `uploadFile()` / `downloadFile()` await `prepareChannel()` (an IPC round trip)
 * before `scheduleTransfer()`, and the file picker runs before that. During all of
 * it the transfer is in no queue, so a queue-only "is it busy?" answers no. A claim
 * is taken **synchronously, before the first `await`**, so the request owns its
 * session from the moment the user asked for it.
 *
 * ## The lifecycle
 *
 * ```
 *            registerSession(id)         beginSessionClose(id)
 *   UNKNOWN ─────────────────▶ ACTIVE ────────────────────▶ CLOSING
 *      ▲                         ▲                             │
 *      │                         └────── forgetSession(id) ─────┤
 *      └──────────────── completeSessionClose(id) ◀─────────────┘
 * ```
 *
 * `UNKNOWN` is not a stored state — it is the absence of an entry. A claim is
 * granted only to an id this module has been told is live, so the registry holds
 * live connections plus in-flight closes and nothing else: no tombstone, no history
 * cap, nothing that can evict a dead id back into being claimable. A retired id is
 * refused because it is *absent*, which is why 4097 connect/close cycles leave an
 * empty registry rather than 4096 remembered ids.
 *
 * `forgetSession` is the one transition back toward claimable, and it restores what
 * the session was before the close was requested: a registered session returns to
 * `ACTIVE`; one that never registered has nothing to restore and is retired. See
 * `Entry.resumable`.
 *
 * If `session_close` rejects, the id stays `CLOSING`: the backend may or may not
 * have torn the connection down, and admitting a transfer onto it is exactly what
 * this module prevents. A new connection gets a new `ssh-<uuid>` from
 * `src-tauri/src/session/ssh.rs`, so nothing depends on the old id reviving.
 */

/** A session this module knows about. `UNKNOWN` is the absence of an entry. */
const ACTIVE = 'active'
const CLOSING = 'closing'

export type SessionState = typeof ACTIVE | typeof CLOSING

/**
 * One entry per live connection or in-flight close.
 *
 * `resumable` records **what the session was before the close was requested**, and
 * exists for exactly one decision: `forgetSession`, the cancelled-release path.
 * Cancelling a close returns the session to what it was — `ACTIVE` if a real
 * connection had registered it, and nothing at all if it was never registered.
 * Without the flag those two cases are indistinguishable, and the safe-looking
 * choice (reopen) turns a cancel request for an id nobody vouched for into a live
 * session — which is the allowlist bypass this module exists to prevent.
 *
 * It is not a tombstone: the flag lives and dies with its entry, so nothing here
 * grows with the number of connections the app has ever made.
 */
interface Entry {
  state: SessionState
  /** Only meaningful while `state === CLOSING`. */
  resumable: boolean
}

const sessions = new Map<string, Entry>()
/** Outstanding claim tokens, per session. Never outlives its session entry. */
const claims = new Map<string, Set<string>>()

let nextToken = 0

export type ClaimRejection = 'closing' | 'unknown'

export type ClaimResult =
  | { ok: true, token: string, release: () => void }
  | { ok: false, reason: ClaimRejection }

/**
 * Record a session as live.
 *
 * Called by the SFTP hook once `sftpConnect` succeeds — the one place that knows a
 * session id is real. Without this the allowlist refuses everything, which is the
 * correct answer for an id nobody vouched for.
 *
 * This is the **only** way an id becomes claimable. `forgetSession` restores a
 * session that was already live; it cannot create one.
 *
 * The durability of "a closed id stays closed" therefore rests on session ids never
 * being reused, which holds: `src-tauri/src/session/ssh.rs` mints `ssh-<uuid>` per
 * connection. If ids were ever recycled, this call would be the one to revisit.
 */
export function registerSession(sessionId: string): void {
  // A session on its way out must not be resurrected by a repeated call. The hook
  // registers once, from the `sftpConnect` that created the id; a second call can
  // only be a duplicate, and the one thing it must never do is turn a close in
  // flight back into a live connection.
  //
  // Registering an already-ACTIVE id is a no-op too, which keeps `resumable`
  // meaningful: it only ever describes a real transition.
  if (sessions.has(sessionId)) return
  sessions.set(sessionId, { state: ACTIVE, resumable: false })
}

/**
 * Take a claim on a session.
 *
 * Synchronous on purpose: every caller must invoke this before its first `await`,
 * because the point is to be visible during that await. There is no interleaving to
 * lose between the lookup and the insert.
 */
export function claimSession(sessionId: string): ClaimResult {
  const entry = sessions.get(sessionId)
  // Two rejections, deliberately distinct so callers can report the right thing:
  // `unknown` means the app never vouched for this id (a late transfer, a stale
  // reference); `closing` means it is on its way out.
  if (entry === undefined) return { ok: false, reason: 'unknown' }
  if (entry.state === CLOSING) return { ok: false, reason: 'closing' }

  nextToken += 1
  const token = `claim-${nextToken}`
  const existing = claims.get(sessionId)
  if (existing) existing.add(token)
  else claims.set(sessionId, new Set([token]))

  let released = false
  return {
    ok: true,
    token,
    release: () => {
      // Idempotent: a double release must not free another holder's claim.
      if (released) return
      released = true
      releaseToken(sessionId, token)
    },
  }
}

function releaseToken(sessionId: string, token: string): void {
  const tokens = claims.get(sessionId)
  if (!tokens) return
  tokens.delete(token)
  if (tokens.size > 0) return
  // The session entry itself is untouched: it is still registered, and
  // `hasClaimsForSession` answers from this map alone, so dropping the empty set
  // keeps the two maps from disagreeing about what exists.
  claims.delete(sessionId)
}

/**
 * Has anything claimed this session?
 *
 * Reads claims only. The queue is a separate source (see `isSessionIdle` in
 * `sftp-transfer-session.ts`); answering from either alone leaves a window.
 */
export function hasClaimsForSession(sessionId: string): boolean {
  return (claims.get(sessionId)?.size ?? 0) > 0
}

/** How many claims this session has. Diagnostics and tests. */
export function claimCountForSession(sessionId: string): number {
  return claims.get(sessionId)?.size ?? 0
}

/**
 * Mark a session as closing and report whether it can close right now.
 *
 * Called by the release path **before** it asks whether the session is idle. The
 * ordering matters: without the marker, a transfer admitted microseconds later takes
 * a claim on a connection already on its way out.
 *
 * Returns false when outstanding claims remain, in which case the caller defers.
 *
 * An id this module has never seen still gets an entry — with `resumable: false`, so
 * cancelling this close retires the id instead of making it live. Recording the
 * unknown id is not a leak (the close retires it either way) and it is what makes a
 * close request for an unknown id refuse claims for it in the interim, instead of
 * leaving a hole where a straggler could be admitted.
 */
export function beginSessionClose(sessionId: string): boolean {
  const previous = sessions.get(sessionId)
  // `resumable` carries across a repeated close request: only a session that was
  // live when the *first* close was requested may be restored by a cancel.
  const wasActive = previous?.state === ACTIVE || previous?.resumable === true
  sessions.set(sessionId, { state: CLOSING, resumable: wasActive })
  return !hasClaimsForSession(sessionId)
}

/**
 * Close confirmed by the backend — retire the id.
 *
 * Deletes the entry, so the id is `UNKNOWN` from here on and every later claim is
 * refused with `unknown`. That is the durable answer without a durable record: the
 * refusal comes from the id being absent, not from remembering that it died.
 */
export function completeSessionClose(sessionId: string): void {
  sessions.delete(sessionId)
  // By construction there are no claims left — the close only proceeds at zero — but
  // a token released after its entry was dropped must be a no-op rather than an
  // orphan, so drop the set explicitly instead of relying on that.
  claims.delete(sessionId)
}

/**
 * Forget a session that is staying (a cancelled release).
 *
 * Only a session that is currently `CLOSING` **and was live before the close was
 * requested** goes back to being claimable. The two refusals are deliberate:
 *
 *   * an `UNKNOWN` id is not resurrected — that would turn "nothing vouched for
 *     this connection" into "this connection is live" on the strength of a cancel;
 *   * an id whose close already completed is not resurrected either — the
 *     connection is gone, and the entry with it.
 *
 * Today the hook does not call this: it keeps a session it cannot release. It
 * exists for a caller that does decide the connection stays, so that decision has
 * one correct way to undo the marker.
 */
export function forgetSession(sessionId: string): void {
  const entry = sessions.get(sessionId)
  if (entry?.state !== CLOSING) return
  if (!entry.resumable) {
    // The close was requested for an id that was never live. There is nothing to
    // restore, so retire it: the cancelled close still ends with the id refused.
    sessions.delete(sessionId)
    claims.delete(sessionId)
    return
  }
  sessions.set(sessionId, { state: ACTIVE, resumable: false })
  if (!hasClaimsForSession(sessionId)) claims.delete(sessionId)
}

/** Is this session marked closing (including while the close is in flight)? */
export function isSessionClosing(sessionId: string): boolean {
  return sessions.get(sessionId)?.state === CLOSING
}

/**
 * Is this id registered as a live session?
 *
 * `false` for both `CLOSING` and `UNKNOWN`. Named for the question callers ask —
 * "may I use this connection?" — rather than "is it not closing?", which is the
 * reading that made an unknown id answer `true` before.
 */
export function isSessionActive(sessionId: string): boolean {
  return sessions.get(sessionId)?.state === ACTIVE
}

/** Test-only: drop every set. */
export function __resetSessionClaimsForTests(): void {
  sessions.clear()
  claims.clear()
  nextToken = 0
}

/**
 * Test-only: how many sessions this module holds an entry for.
 *
 * Bounded by live connections plus in-flight closes. A completed close removes its
 * entry, so this returns to zero after a connect/close cycle and does not grow with
 * the number of connections the app has ever made.
 */
export function __trackedSessionCount(): number {
  return sessions.size
}

/**
 * Test-only: sessions with at least one outstanding claim.
 *
 * Separate from `__trackedSessionCount` because the two answer different leak
 * questions: this one catches claims that never released, the other catches session
 * entries that never retired.
 */
export function __claimedSessionCount(): number {
  return claims.size
}
