import { sshService } from '@/service/ssh'

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
  if (!isBusy(sessionId)) {
    // Even on the immediate path, drop any watcher of the same id first: the
    // caller is telling us the connection is done, and a leftover timer would
    // close it a second time.
    cancelDeferredRelease(sessionId)
    void sshService.close(sessionId).catch(() => undefined)
    return true
  }
  // Already deferred: one watcher is enough, and the answer stays the same.
  if (deferredReleases.has(sessionId)) return false

  const timer = setInterval(() => {
    if (isBusy(sessionId)) return
    clearInterval(timer)
    deferredReleases.delete(sessionId)
    void sshService.close(sessionId).catch(() => undefined)
  }, DEFERRED_RELEASE_POLL_MS)
  deferredReleases.set(sessionId, () => clearInterval(timer))
  return false
}

/** Is this session already waiting for its transfers to finish? */
export function isDeferred(sessionId: string): boolean {
  return deferredReleases.has(sessionId)
}

/**
 * Drop a session's watcher without closing anything.
 *
 * Used when the connection is being closed by another path (a host switch that
 * has already decided to tear it down), so the watcher cannot close it a second
 * time afterwards.
 */
export function cancelDeferredRelease(sessionId: string): void {
  const dispose = deferredReleases.get(sessionId)
  if (!dispose) return
  dispose()
  deferredReleases.delete(sessionId)
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
