/**
 * What an integrity check actually proved.
 *
 * ## Why this is derived and not stored
 *
 * The record used to carry `matches?: boolean`. `undefined` then meant two different
 * things — "the hashes are still being computed" and "one side could not be hashed"
 * — and the only way to tell them apart was to re-read both statuses. That is a
 * second source of truth for a fact that is already fully described by
 * `localStatus` / `remoteStatus`, and two sources of truth drift.
 *
 * Collapsing them is worse than ambiguous: reporting a server that refused to open
 * the file as "the file differs" is a corruption claim the app has no evidence for.
 * So `verified` and `mismatch` are the *only* two verdicts that assert something
 * about bytes, and both require two successful hashes.
 *
 * ## What each verdict means to a user
 *
 * | verdict        | means                                                        |
 * | -------------- | ------------------------------------------------------------ |
 * | `unchecked`    | no verification was attempted (e.g. the transfer failed)      |
 * | `computing`    | at least one side is still hashing                            |
 * | `verified`     | both sides hashed, and the SHA-256 values are equal           |
 * | `mismatch`     | both sides hashed, and the SHA-256 values differ               |
 * | `indeterminate`| a hash could not be computed — says nothing about the file    |
 *
 * `indeterminate` is deliberately not called "failed": the *check* failed, not the
 * file. And a mismatch never deletes or repairs anything — the transferred file
 * stays exactly where the user put it, and the verdict is information.
 */
import type { TransferRecord } from './transfer-queue'

export type ChecksumVerdict =
  | 'unchecked'
  | 'computing'
  | 'verified'
  | 'mismatch'
  | 'indeterminate'

/** Which side errored first, for the error text. `null` when neither did. */
export type ChecksumFailedSide = 'local' | 'remote' | null

export interface ChecksumVerdictDetail {
  verdict: ChecksumVerdict
  /** The first side that reported an error, if any. */
  failedSide: ChecksumFailedSide
  /** The error text of that side, if it reported one. */
  error: string | null
}

/**
 * Read a transfer record's integrity verdict.
 *
 * Accepts `undefined` (a record that has no `checksum` yet) so callers do not have
 * to guard before asking. A record that failed to transfer and never started a
 * check reads `unchecked`, not `indeterminate` — nothing was attempted, so nothing
 * was disproved.
 */
export function checksumVerdict(
  record: Pick<TransferRecord, 'checksum'> | undefined,
): ChecksumVerdictDetail {
  const checksum = record?.checksum
  if (!checksum) return { verdict: 'unchecked', failedSide: null, error: null }

  const { localStatus, remoteStatus } = checksum
  if (localStatus === 'error') {
    return {
      verdict: 'indeterminate',
      failedSide: 'local',
      error: checksum.localError ?? null,
    }
  }
  if (remoteStatus === 'error') {
    return {
      verdict: 'indeterminate',
      failedSide: 'remote',
      error: checksum.remoteError ?? null,
    }
  }

  if (localStatus !== 'done' || remoteStatus !== 'done') {
    return { verdict: 'computing', failedSide: null, error: null }
  }

  // Both sides hashed. A side that reports `done` without a hash is malformed
  // input rather than a match — refuse to call it verified.
  if (!checksum.localHash || !checksum.remoteHash) {
    return {
      verdict: 'indeterminate',
      failedSide: null,
      error: 'a hash was reported as computed but no value was recorded',
    }
  }

  return {
    verdict: checksum.localHash === checksum.remoteHash ? 'verified' : 'mismatch',
    failedSide: null,
    error: null,
  }
}

/** Percentage of the *checksum* read that has completed, 0–100. */
export function checksumPercent(
  record: Pick<TransferRecord, 'checksum'> | undefined,
): number {
  const total = record?.checksum?.bytesTotal ?? 0
  const done = record?.checksum?.bytesDone ?? 0
  if (total <= 0) return 0
  return Math.min(100, Math.round((done / total) * 100))
}
