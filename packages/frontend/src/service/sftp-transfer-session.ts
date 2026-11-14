import { hasClaimsForSession } from './sftp-session-claim'
import { useTransferQueue } from '@/store/transfer-queue'

/**
 * Is anything still using this SSH session?
 *
 * The SFTP view opens one SSH session and hands its id to every transfer it
 * starts. Closing that session when the panel unmounts is what truncates an
 * upload that is halfway through (`INV-14`). The panel therefore has to ask this
 * before releasing the connection.
 *
 * Counts `queued` as well as `running`: a queued transfer has not opened its
 * bytes yet, but it will, and closing the session underneath it fails it for a
 * reason the user did not cause.
 *
 * Deliberately a pure read of the queue — no subscription, no React. The caller
 * decides when to ask.
 *
 * **This answers only half the question.** A transfer that has been requested but
 * not yet enqueued is in no queue at all: `uploadFile()` awaits `prepareChannel()`
 * (an IPC round trip) before `scheduleTransfer()`, and the file-picker dialog runs
 * before that. Callers deciding whether a connection may close must use
 * `isSessionIdle()`, which also consults the session claims.
 */
export function hasTransfersForSession(sessionId: string): boolean {
  return useTransferQueue
    .getState()
    .transfers.some(
      transfer =>
        transfer.sessionId === sessionId &&
        (transfer.status === 'running' || transfer.status === 'queued'),
    )
}

/**
 * Is nothing at all using this session?
 *
 * Both sources matter: the queue for transfers that have started, and the claims
 * for transfers that have been requested but not scheduled. Answering from either
 * alone leaves a window in which a live transfer looks idle — with the queue alone
 * that window is every `await` before `scheduleTransfer()`, which is where the
 * upload-then-close-the-dock failure lived.
 */
export function isSessionIdle(sessionId: string): boolean {
  if (hasClaimsForSession(sessionId)) return false
  return !hasTransfersForSession(sessionId)
}

/**
 * A predicate for `releaseOrDefer`, which asks "is this session busy?".
 *
 * Named so call sites read as the question they are actually asking. Passing
 * `hasTransfersForSession` directly is the defect this replaced.
 */
export function isSessionBusy(sessionId: string): boolean {
  return !isSessionIdle(sessionId)
}
