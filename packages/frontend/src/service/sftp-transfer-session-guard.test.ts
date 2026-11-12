// UX-1c — INV-14: closing the panel must not truncate a transfer.
//
// The defect: `use-sftp-remote.ts` released its SSH session in the cleanup of the
// effect that owns the host binding — `return () => releaseSession()`. Unmounting
// the SFTP view therefore closed the connection, and every transfer carries that
// connection's session id. A dock makes this reachable constantly: the user opens
// Files, starts an upload, goes back to the terminal, and the upload dies halfway
// through with an error nobody caused.
//
// The fix defers the close while anything is still using the session. These tests
// drive the queue, not a mock of it: `hasTransfersForSession` reads the real
// transfer store.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hasTransfersForSession } from '@/service/sftp-transfer-session'
import { useTransferQueue } from '@/store/transfer-queue'
import type { TransferRecord } from '@/store/transfer-queue'

function record(
  id: string,
  sessionId: string,
  status: TransferRecord['status'],
): TransferRecord {
  return {
    id,
    kind: 'upload',
    name: `${id}.bin`,
    localPath: `/tmp/${id}.bin`,
    remotePath: `/srv/${id}.bin`,
    sessionId,
    status,
    bytesDone: 0,
    bytesTotal: 100,
    speed: 0,
    startedAt: 1,
  }
}

describe('hasTransfersForSession', () => {
  beforeEach(() => {
    useTransferQueue.setState({ transfers: [] })
  })

  afterEach(() => {
    useTransferQueue.setState({ transfers: [] })
  })

  it('is false for an empty queue', () => {
    expect(hasTransfersForSession('s1')).toBe(false)
  })

  it('is true while a transfer is running', () => {
    useTransferQueue.setState({ transfers: [record('a', 's1', 'running')] })
    expect(hasTransfersForSession('s1')).toBe(true)
  })

  it('is true while a transfer is queued', () => {
    // A queued transfer has not opened its bytes yet, but it will. Closing the
    // session underneath it fails it for a reason the user did not cause.
    useTransferQueue.setState({ transfers: [record('a', 's1', 'queued')] })
    expect(hasTransfersForSession('s1')).toBe(true)
  })

  it('is false once the last transfer settles', () => {
    // This is what lets the deferred release actually close the connection.
    useTransferQueue.setState({ transfers: [record('a', 's1', 'done')] })
    expect(hasTransfersForSession('s1')).toBe(false)
  })

  it('does not count a different session', () => {
    useTransferQueue.setState({ transfers: [record('a', 's2', 'running')] })
    expect(hasTransfersForSession('s1')).toBe(false)
  })

  it('counts errors as settled', () => {
    useTransferQueue.setState({ transfers: [record('a', 's1', 'error')] })
    expect(hasTransfersForSession('s1')).toBe(false)
  })

  it('counts a cancellation as settled', () => {
    useTransferQueue.setState({ transfers: [record('a', 's1', 'cancelled')] })
    expect(hasTransfersForSession('s1')).toBe(false)
  })

  it('finds a live transfer among finished ones', () => {
    useTransferQueue.setState({
      transfers: [
        record('a', 's1', 'done'),
        record('b', 's1', 'running'),
        record('c', 's1', 'error'),
      ],
    })
    expect(hasTransfersForSession('s1')).toBe(true)
  })
})
