import { sshService } from '@/service/ssh'
import {
  beginSessionClose,
  completeSessionClose,
  forgetSession,
  hasClaimsForSession,
} from '@/service/sftp-session-claim'

/**
 * Sessions whose panel is gone but whose transfers are still running.
 *
 * `Map<sessionId, disposer>`, not `Set<sessionId>`. The set form recorded *that* a
 * session was deferred and never *which timer* was watching it, so every repeat
 * call scheduled another interval — three calls, three `close` IPC calls for one
 * connection once the transfers settled. `close` is not free and it is not
 * idempotent at the boundary: the second call crosses it against a session the
 * backend has already dropped.
 *
 * One entry per session is the whole invariant: at most one pending release, and
 * repeating the request is a no-op that returns the same "still deferred" answer.
 */
const deferredReleases = new Map<string, () => void>()

/** How often a deferred release re-checks whether its transfers finished. */
const DEFERRED_RELEASE_POLL_MS = 1_000

/**
 * Release a connection, or schedule the release while transfers still use it.
 *
 * Returns `true` when the caller should forget the session now (it is closed, or
 * there was none). Returns `false` when the connection is still in use — the
 * caller must not reuse it for another host, but must not close it either.
 *
 * Idempotent while deferred: calling it again for a session that already has a
 * watcher neither schedules a second one nor shortens the existing schedule.
 */
export function releaseOrDefer(
  sessionId: string,
  isBusy: (sessionId: string) => boolean,
): boolean {
  // Refuse new work first, before asking whether the session is idle.
  //
  // The ordering is the whole point. Asking first and marking after leaves a gap:
  // a transfer admitted in between takes a claim on a connection that is already
  // on its way out, which is the same class of failure the claim mechanism exists
  // to prevent — just moved by a few microseconds.
  //
  // `beginSessionClose` also reports whether any claim is still outstanding, which
  // is half of the idle question. The queue is the other half and comes from the
  // caller's predicate.
  const claimIdle = beginSessionClose(sessionId)

  if (claimIdle && !isBusy(sessionId)) {
    // Even on the immediate path, drop any watcher of the same id first: the
    // caller is telling us the connection is done, and a leftover timer would
    // close it a second time.
    cancelDeferredRelease(sessionId)
    // Retire the id only once the backend has confirmed.
    //
    // `close()` is an IPC round trip. Deleting the closing marker synchronously
    // (what this used to do) opened exactly the window the claim mechanism exists
    // to prevent: a late `uploadFile` in that round trip found no record, was
    // admitted, and the in-flight close then dropped the connection under it.
    //
    // On rejection the id stays closing. The backend may or may not have torn the
    // connection down, and admitting work onto it is the failure we are here to
    // stop; a new connection gets a fresh `ssh-<uuid>` anyway.
    void sshService
      .close(sessionId)
      .then(() => completeSessionClose(sessionId))
      .catch(() => undefined)
    return true
  }
  // Already deferred: one watcher is enough, and the answer stays the same.
  if (deferredReleases.has(sessionId)) return false

  // Outlive the claim: a claim taken before this call may still be in flight —
  // the upload is preparing, or the user is still in the file picker. Checking
  // only the caller's predicate here would close the connection under it, which
  // is exactly the truncation the claim mechanism exists to stop. The claim check
  // is intrinsic rather than left to the caller so a call site that passes the
  // queue-only predicate cannot silently lose it.
  const timer = setInterval(() => {
    if (hasClaimsForSession(sessionId) || isBusy(sessionId)) return
    clearInterval(timer)
    deferredReleases.delete(sessionId)
    // Same rule as the immediate path: the watcher has decided to close, but the
    // id stays in `closing` until the backend confirms. Both guards above already
    // said nothing is using it, which is what lets the close happen at all.
    void sshService
      .close(sessionId)
      .then(() => completeSessionClose(sessionId))
      .catch(() => undefined)
  }, DEFERRED_RELEASE_POLL_MS)
  deferredReleases.set(sessionId, () => clearInterval(timer))
  return false
}

/** Is this session already waiting for its transfers to finish? */
export function isDeferred(sessionId: string): boolean {
  return deferredReleases.has(sessionId)
}

/**
 * Drop a session's watcher without closing anything and without touching the
 * claim-side state.
 *
 * Used when the connection is being torn down by this same path (it is closed
 * immediately below), so the watcher cannot close it a second time.
 */
export function cancelDeferredRelease(sessionId: string): void {
  const dispose = deferredReleases.get(sessionId)
  if (!dispose) return
  dispose()
  deferredReleases.delete(sessionId)
}

/**
 * Abandon a deferred release because the connection is staying after all.
 *
 * Distinct from `cancelDeferredRelease`: this one also clears the claim-side
 * closing marker. Two functions because they mean opposite things — "it is being
 * closed, stop watching" versus "it is *not* being closed, make it usable again"
 * — and one function that did both would silently reopen a session on its way out.
 *
 * Today the hook does not call either: it keeps the session when it cannot release
 * it. This exists for a caller that does decide to keep the connection, so that
 * decision has a correct way to undo the marker.
 */
export function abandonDeferredRelease(sessionId: string): void {
  cancelDeferredRelease(sessionId)
  forgetSession(sessionId)
}

/** Test-only: how many sessions currently have a release scheduled. */
export function __deferredSessions(): number {
  return deferredReleases.size
}

/** Test-only: drop every scheduled release without closing anything. */
export function __resetDeferredReleases(): void {
  for (const dispose of deferredReleases.values()) dispose()
  deferredReleases.clear()
}
