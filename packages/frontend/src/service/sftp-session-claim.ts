/**
 * Session claims — the record of "this transfer exists but is not in the queue yet".
 *
 * ## The window this closes
 *
 * `uploadFile()` / `downloadFile()` call `await prepareChannel(args)` and only then
 * `scheduleTransfer(args)`. `prepareChannel` installs the progress listener, which
 * is a Tauri IPC round trip; before it there is a file-picker dialog, which the
 * user can leave open for as long as they like. During all of that the transfer is
 * in **no** queue, so `hasTransfersForSession()` — which reads the queue — answers
 * "nothing is using this session". If the dock closes in that window,
 * `releaseOrDefer()` sees an idle session, closes the connection, and the upload
 * then starts against a session id the backend has already dropped.
 *
 * A claim is taken **synchronously, before the first `await`**, so the request owns
 * its session from the moment the user asked for it rather than from whenever the
 * queue happens to catch up.
 *
 * ## Why reference counts
 *
 * Two uploads can be preparing for the same session at once (`uploadPaths` starts
 * them all in parallel). The first one to finish must not free the other's claim.
 *
 * ## Why tokens
 *
 * A reference count alone answers "is anything using this?", not "is *this* request
 * still using it?". Without a token, a `finally` that runs twice — or a release
 * that arrives for a claim the caller already dropped — decrements someone else's
 * count and either closes a live session early or leaves the count permanently
 * positive. Each claim carries its own token, and releasing checks the token is
 * still outstanding before it decrements.
 *
 * ## Why a closing set
 *
 * A session that is being closed must not accept new work. The check and the
 * increment have to happen together — this module is synchronous by construction,
 * so there is no `await` between them and no interleaving to lose.
 */

/** Per-session claim bookkeeping. */
interface SessionClaims {
  /** Outstanding tokens. A Set, not a count: the token is what makes release idempotent. */
  tokens: Set<string>
  /**
   * Set once the session is being torn down. A claimed token may still be released
   * (its transfer is still finishing), but no new claim is granted.
   */
  closing: boolean
}

const sessions = new Map<string, SessionClaims>()

let nextToken = 0

export type ClaimRejection = 'closing'

export type ClaimResult =
  | { ok: true, token: string, release: () => void }
  | { ok: false, reason: ClaimRejection }

/**
 * Take a claim on a session.
 *
 * Synchronous on purpose. Every caller must invoke this before its first `await`,
 * because the whole point is to be visible to `isSessionIdle()` during that await.
 */
export function claimSession(sessionId: string): ClaimResult {
  const existing = sessions.get(sessionId)
  if (existing?.closing) return { ok: false, reason: 'closing' }

  nextToken += 1
  const token = `claim-${nextToken}`
  if (existing) {
    existing.tokens.add(token)
  } else {
    sessions.set(sessionId, { tokens: new Set([token]), closing: false })
  }

  let released = false
  return {
    ok: true,
    token,
    release: () => {
      if (released) return
      released = true
      releaseToken(sessionId, token)
    },
  }
}

function releaseToken(sessionId: string, token: string): void {
  const entry = sessions.get(sessionId)
  if (!entry) return
  entry.tokens.delete(token)
  // A closing session keeps its entry until the last token is gone, so the
  // `closing` flag survives as long as anything might still free it.
  if (entry.tokens.size === 0 && !entry.closing) sessions.delete(sessionId)
}

/**
 * Has nothing at all claimed this session?
 *
 * Reads claims only. The queue is a separate source (see `isSessionIdle` in
 * `sftp-transfer-session.ts`), and answering from either one alone leaves a window.
 */
export function hasClaimsForSession(sessionId: string): boolean {
  const entry = sessions.get(sessionId)
  return entry !== undefined && entry.tokens.size > 0
}

/** How many claims this session has. Diagnostics and tests. */
export function claimCountForSession(sessionId: string): number {
  return sessions.get(sessionId)?.tokens.size ?? 0
}

/**
 * Mark a session as closing: no new claims are granted from this point.
 *
 * Called by the release path **before** it asks whether the session is idle. The
 * ordering matters: without the marker, a transfer that starts microseconds after
 * the idle check would be granted a claim on a connection already on its way out.
 *
 * Returns false when the session cannot be closed right now — it still has
 * outstanding claims — in which case the caller defers, exactly as it does for a
 * busy queue.
 */
export function beginSessionClose(sessionId: string): boolean {
  const entry = sessions.get(sessionId)
  if (!entry) {
    // Nothing claimed it: record the closing state anyway so a claim that arrives
    // between this call and the actual close is refused rather than granted.
    sessions.set(sessionId, { tokens: new Set(), closing: true })
    return true
  }
  entry.closing = true
  return entry.tokens.size === 0
}

/**
 * Drop a session's bookkeeping entirely.
 *
 * Only for a **cancelled** release — one where the connection turned out to be
 * staying. The session must become usable again, and an id left marked closing
 * would refuse every future transfer with no visible reason.
 *
 * The completed-close path deliberately does *not* call this. A closed connection's
 * id must keep refusing claims: `uploadFile` on a dead session would otherwise be
 * admitted and fail at the backend, which is a worse answer than refusing it here.
 * The residue is one small record per connection the app ever made — session ids
 * are unique and never reused, so it cannot grow faster than the user connects.
 */
export function forgetSession(sessionId: string): void {
  sessions.delete(sessionId)
}

/** Is this session marked closing? */
export function isSessionClosing(sessionId: string): boolean {
  return sessions.get(sessionId)?.closing ?? false
}

/** Test-only: drop every claim and closing marker. */
export function __resetSessionClaimsForTests(): void {
  sessions.clear()
  nextToken = 0
}

/** Test-only: how many sessions have any claim bookkeeping. */
export function __claimedSessionCount(): number {
  return sessions.size
}
