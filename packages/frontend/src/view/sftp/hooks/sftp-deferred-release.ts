import { sshService } from '@/service/ssh'

/**
 * Sessions whose panel is gone but whose transfers are still running.
 *
 * Module scope, not hook state: the hook has already unmounted by the time this
 * matters, and a remount of the same host must not start a second watcher for a
 * connection it does not own.
 */
const deferredReleases = new Set<string>()

/** How often a deferred release re-checks whether its transfers finished. */
const DEFERRED_RELEASE_POLL_MS = 1_000

/**
 * Release a connection, or schedule the release while transfers still use it.
 *
 * Extracted from `use-sftp-remote` when that file hit its size limit, and because
 * the rule deserves to be readable on its own: `INV-14` says closing a panel must
 * not truncate an upload, and this is the whole of that rule.
 *
 * Returns `true` when the caller should forget the session now (it is closed, or
 * there was none). Returns `false` when the connection is still in use — the
 * caller must not reuse it for another host, but must not close it either.
 */
export function releaseOrDefer(
  sessionId: string,
  isBusy: (sessionId: string) => boolean,
): boolean {
  if (!isBusy(sessionId)) {
    void sshService.close(sessionId).catch(() => undefined)
    return true
  }
  deferredReleases.add(sessionId)
  const timer = setInterval(() => {
    if (isBusy(sessionId)) return
    clearInterval(timer)
    deferredReleases.delete(sessionId)
    void sshService.close(sessionId).catch(() => undefined)
  }, DEFERRED_RELEASE_POLL_MS)
  return false
}

/** Is this session already waiting for its transfers to finish? */
export function isDeferred(sessionId: string): boolean {
  return deferredReleases.has(sessionId)
}
