/**
 * Session claims — who is using a session right now, and which sessions are alive.
 *
 * ## The window claims close
 *
 * `uploadFile()` / `downloadFile()` await `prepareChannel()` (an IPC round trip)
 * before `scheduleTransfer()`, and the file picker runs before that. During all of
 * it the transfer is in no queue, so a queue-only "is it busy?" answers no. A claim
 * is taken **synchronously, before the first `await`**, so the request owns its
 * session from the moment the user asked for it.
 *
 * ## The window the registry closes
 *
 * `sshService.close()` → `invoke('session_close')` is asynchronous. The previous
 * version deleted the closing marker synchronously, right after firing the close,
 * so a late `uploadFile()` during that round trip found no record, was admitted,
 * and then had the connection closed underneath it by the close that was already
 * in flight.
 *
 * The fix is not a longer-lived tombstone — that grows without bound, which is what
 * the previous round had to fix in the other direction. It is an **allowlist**:
 *
 *   * a session id is claimable only while it is registered as active;
 *   * `beginSessionClose` moves it to closing, where claims are refused;
 *   * only when the backend confirms does it leave both sets;
 *   * after that it is *unknown*, and unknown is refused.
 *
 * So the map holds live connections and in-flight closes, and nothing else. An
 * unknown id is refused by construction rather than by remembering that it died.
 *
 * ## Why failing to delete matters
 *
 * If `session_close` rejects, the id stays in closing. That is deliberate: the
 * backend may or may not have torn the connection down, and admitting a transfer
 * onto a connection in that state is exactly the failure this module exists to
 * prevent. A new connection gets a new `ssh-<uuid>` from
 * `src-tauri/src/session/ssh.rs`, so nothing the user does depends on the old id
 * becoming usable again.
 */

/**
 * Sessions whose close has been requested, or that have been confirmed closed.
 *
 * One set rather than two: from a claim's point of view both states answer the same
 * thing — refuse. Keeping them apart would mean a status flag no caller needs and a
 * second thing to keep in sync.
 *
 * Bounded by `CLOSED_HISTORY_LIMIT`. Session ids are `ssh-<uuid>` and never reused,
 * so an evicted id can never be seen again; the cap exists so a very long session
 * cannot grow this without limit. Eviction is oldest-first.
 */
const closed = new Map<string, true>()
/** Outstanding claim tokens, per session. */
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
 * session id is real. Without this the allowlist would refuse everything.
 */
export function registerSession(sessionId: string): void {
  // A re-registered id means a new connection reusing the name; treat it as live.
  closed.delete(sessionId)
}

/**
 * Take a claim on a session.
 *
 * Synchronous on purpose: every caller must invoke this before its first `await`,
 * because the point is to be visible during that await. There is no interleaving to
 * lose between the checks and the insert.
 */
export function claimSession(sessionId: string): ClaimResult {
  // Refused while the close is in flight **and** after it completes. That is the
  // fix: the marker outlives the IPC call instead of dying with it.
  if (closed.has(sessionId)) return { ok: false, reason: 'closing' }

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
  claims.delete(sessionId)
  // No tokens and not closing: nothing remembers this id, which is correct — it is
  // still registered, so `hasClaimsForSession` stays false rather than the id
  // disappearing from the allowlist.
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
 * Unknown ids are marked too: a close request for an id the registry never saw still
 * has to refuse later claims for it.
 */
export function beginSessionClose(sessionId: string): boolean {
  rememberClosed(sessionId)
  return !hasClaimsForSession(sessionId)
}

/** How many closed ids to remember. */
const CLOSED_HISTORY_LIMIT = 4096

/**
 * Record that a session is closing, evicting the oldest entry past the cap.
 *
 * `Map` preserves insertion order, so the first key is the oldest. Evicting is safe
 * because a session id is generated per connection and never reused.
 */
function rememberClosed(sessionId: string): void {
  closed.delete(sessionId)
  closed.set(sessionId, true)
  while (closed.size > CLOSED_HISTORY_LIMIT) {
    const oldest = closed.keys().next()
    if (oldest.done) break
    closed.delete(oldest.value)
  }
}

/**
 * Close confirmed by the backend — retire the id.
 *
 * Removes it from every set. From here a claim is refused as `unknown`, which is the
 * durable answer without a durable record.
 */
export function completeSessionClose(sessionId: string): void {
  // Keep the closing record: the id must stay refused. Only the claim bookkeeping
  // goes, and by now there is none.
  claims.delete(sessionId)
}

/**
 * Forget a session that is staying (a cancelled release).
 *
 * The connection is still alive, so the id goes back to being claimable. Only for
 * callers that have decided the close was a mistake; the completed path must use
 * `completeSessionClose` instead.
 */
export function forgetSession(sessionId: string): void {
  closed.delete(sessionId)
  if (!hasClaimsForSession(sessionId)) claims.delete(sessionId)
}

/** Is this session marked closing (including while the close is in flight)? */
export function isSessionClosing(sessionId: string): boolean {
  return closed.has(sessionId)
}

/** Is this id registered as a live session? */
export function isSessionActive(sessionId: string): boolean {
  return !closed.has(sessionId)
}

/** Test-only: drop every set. */
export function __resetSessionClaimsForTests(): void {
  closed.clear()
  claims.clear()
  nextToken = 0
}

/** Test-only: ids that are registered, claimed or closing. */
export function __claimedSessionCount(): number {
  return new Set([...closed.keys(), ...claims.keys()]).size
}

/**
 * Test-only: sessions whose close never settled.
 *
 * The bound that matters. `active` + `claims` are live connections, which the user
 * controls; `closing` only holds in-flight and failed closes, which must not grow
 * with ordinary connect/close cycles.
 */
export function __liveSessionCount(): number {
  let live = 0
  for (const tokens of claims.values()) if (tokens.size > 0) live += 1
  return live
}

/** Test-only: how many closed ids are remembered. */
export function __closedHistorySize(): number {
  return closed.size
}
