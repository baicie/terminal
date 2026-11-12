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
