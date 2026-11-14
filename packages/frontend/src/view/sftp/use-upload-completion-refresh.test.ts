// TN-SFTP-01 — refresh the listing when the upload landed, not when it was queued.
//
// The defect: `handleUpload` did `await uploadPaths(...)` and then `loadRemoteDir`.
// `uploadPaths` resolves as soon as every file has been handed to `scheduleTransfer`,
// which for a three-file batch under `MAX_CONCURRENT=3` happens before a single byte
// has moved. The user saw "upload succeeded" and no new row.
//
// These tests drive the real transfer store: a record is enqueued and then moved to
// its terminal state the way the queue manager does it, and the tracker is asked what
// it decided. `expect(loadDir).not.toHaveBeenCalled()` immediately after enqueue is
// the assertion that fails on the old implementation.

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTransferQueue } from '@/store/transfer-queue'
import type { TransferRecord } from '@/store/transfer-queue'
import {
  createUploadRefreshTracker,
  remoteDirOf,
  useUploadCompletionRefresh,
} from './use-upload-completion-refresh'

/** The coalescing window, mirrored here so the assertions read in the same units. */
const COALESCE = 250

function record(
  overrides: Partial<TransferRecord> & Pick<TransferRecord, 'id'>,
): TransferRecord {
  return {
    kind: 'upload',
    name: 'a.bin',
    localPath: '/tmp/a.bin',
    remotePath: '/srv/dir/a.bin',
    sessionId: 's1',
    status: 'queued',
    bytesDone: 0,
    bytesTotal: 100,
    speed: 0,
    startedAt: 1,
    ...overrides,
  }
}

describe('remoteDirOf', () => {
  it('strips the file name', () => {
    expect(remoteDirOf('/srv/a/b.bin')).toBe('/srv/a')
  })

  it('handles a top-level file', () => {
    expect(remoteDirOf('/b.bin')).toBe('/')
  })

  it('ignores a trailing slash', () => {
    expect(remoteDirOf('/srv/a/')).toBe('/srv')
  })

  it('returns empty for a bare name', () => {
    expect(remoteDirOf('b.bin')).toBe('')
  })
})

describe('createUploadRefreshTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not refresh when the transfer is only queued', () => {
    const loadDir = vi.fn()
    const tracker = createUploadRefreshTracker({
      sessionId: 's1',
      remoteDir: '/srv/dir',
      loadDir,
    })
    tracker.observe(record({ id: 't1', status: 'queued' }))
    // Advance past the window: a mutation that treats `queued` as a landing would
    // schedule a refresh, and only waiting reveals it.
    vi.advanceTimersByTime(COALESCE * 4)
    expect(loadDir).not.toHaveBeenCalled()
  })

  it('does not refresh while running', () => {
    const loadDir = vi.fn()
    const tracker = createUploadRefreshTracker({
      sessionId: 's1',
      remoteDir: '/srv/dir',
      loadDir,
    })
    tracker.observe(record({ id: 't1', status: 'running' }))
    vi.advanceTimersByTime(COALESCE * 4)
    expect(loadDir).not.toHaveBeenCalled()
  })

  it('a queued record followed by a real done refreshes exactly once', () => {
    // The exact sequence a live transfer produces. If `queued` counted as a
    // landing, the count would be two.
    const loadDir = vi.fn()
    const tracker = createUploadRefreshTracker({
      sessionId: 's1',
      remoteDir: '/srv/dir',
      loadDir,
    })
    tracker.observe(record({ id: 't1', status: 'queued' }))
    tracker.observe(record({ id: 't1', status: 'running' }))
    tracker.observe(record({ id: 't1', status: 'done' }))
    vi.advanceTimersByTime(COALESCE)
    expect(loadDir).toHaveBeenCalledTimes(1)
  })

  it('refreshes when the upload lands', () => {
    const loadDir = vi.fn()
    const tracker = createUploadRefreshTracker({
      sessionId: 's1',
      remoteDir: '/srv/dir',
      loadDir,
    })
    tracker.observe(record({ id: 't1', status: 'done' }))
    vi.advanceTimersByTime(COALESCE)
    expect(loadDir).toHaveBeenCalledTimes(1)
    expect(loadDir).toHaveBeenCalledWith('/srv/dir')
  })

  it('refreshes once for a batch of files in the same directory', () => {
    const loadDir = vi.fn()
    const tracker = createUploadRefreshTracker({
      sessionId: 's1',
      remoteDir: '/srv/dir',
      loadDir,
    })
    for (let index = 0; index < 12; index += 1) {
      tracker.observe(record({ id: `t${index}`, status: 'done' }))
      vi.advanceTimersByTime(50)
    }
    vi.advanceTimersByTime(COALESCE)
    // Twelve listings on one SFTP channel would be worse than the bug.
    expect(loadDir).toHaveBeenCalledTimes(1)
  })

  it('a later landing pushes the refresh out rather than adding one', () => {
    const loadDir = vi.fn()
    const tracker = createUploadRefreshTracker({
      sessionId: 's1',
      remoteDir: '/srv/dir',
      loadDir,
    })
    tracker.observe(record({ id: 'a', status: 'done' }))
    vi.advanceTimersByTime(COALESCE - 10)
    expect(loadDir).not.toHaveBeenCalled()
    tracker.observe(record({ id: 'b', status: 'done' }))
    vi.advanceTimersByTime(COALESCE)
    expect(loadDir).toHaveBeenCalledTimes(1)
  })

  it('does not refresh on error or cancellation', () => {
    const loadDir = vi.fn()
    const tracker = createUploadRefreshTracker({
      sessionId: 's1',
      remoteDir: '/srv/dir',
      loadDir,
    })
    tracker.observe(record({ id: 'a', status: 'error' }))
    tracker.observe(record({ id: 'b', status: 'cancelled' }))
    vi.advanceTimersByTime(COALESCE * 4)
    expect(loadDir).not.toHaveBeenCalled()
  })

  it('ignores a download', () => {
    const loadDir = vi.fn()
    const tracker = createUploadRefreshTracker({
      sessionId: 's1',
      remoteDir: '/srv/dir',
      loadDir,
    })
    tracker.observe(record({ id: 'd', kind: 'download', status: 'done' }))
    vi.advanceTimersByTime(COALESCE * 4)
    expect(loadDir).not.toHaveBeenCalled()
  })

  it('ignores another session', () => {
    const loadDir = vi.fn()
    const tracker = createUploadRefreshTracker({
      sessionId: 's1',
      remoteDir: '/srv/dir',
      loadDir,
    })
    tracker.observe(record({ id: 'x', sessionId: 's2', status: 'done' }))
    vi.advanceTimersByTime(COALESCE * 4)
    expect(loadDir).not.toHaveBeenCalled()
  })

  it('ignores a file that landed in another directory', () => {
    // A host switch mid-upload must not load one server's tree into the other's
    // listing, and neither must a navigation.
    const loadDir = vi.fn()
    const tracker = createUploadRefreshTracker({
      sessionId: 's1',
      remoteDir: '/srv/elsewhere',
      loadDir,
    })
    tracker.observe(record({ id: 'x', remotePath: '/srv/dir/x.bin', status: 'done' }))
    vi.advanceTimersByTime(COALESCE * 4)
    expect(loadDir).not.toHaveBeenCalled()
  })

  it('does not refresh after disposal', () => {
    const loadDir = vi.fn()
    const tracker = createUploadRefreshTracker({
      sessionId: 's1',
      remoteDir: '/srv/dir',
      loadDir,
    })
    tracker.dispose()
    tracker.observe(record({ id: 't1', status: 'done' }))
    vi.advanceTimersByTime(COALESCE * 4)
    expect(loadDir).not.toHaveBeenCalled()
  })

  it('never refreshes for the same transfer twice', () => {
    const loadDir = vi.fn()
    const tracker = createUploadRefreshTracker({
      sessionId: 's1',
      remoteDir: '/srv/dir',
      loadDir,
    })
    tracker.observe(record({ id: 't1', status: 'done' }))
    tracker.observe(record({ id: 't1', status: 'done' }))
    vi.advanceTimersByTime(COALESCE)
    expect(loadDir).toHaveBeenCalledTimes(1)
  })

  it('forgets the previous batch when the target changes', () => {
    const loadDir = vi.fn()
    const tracker = createUploadRefreshTracker({
      sessionId: 's1',
      remoteDir: '/srv/dir',
      loadDir,
    })
    tracker.setTarget({ sessionId: 's1', remoteDir: '/srv/other', loadDir })
    tracker.observe(record({ id: 't1', status: 'done' }))
    vi.advanceTimersByTime(COALESCE)
    expect(loadDir).not.toHaveBeenCalled()
  })

  it('does nothing without a target', () => {
    const tracker = createUploadRefreshTracker(null)
    expect(() => tracker.observe(record({ id: 't1', status: 'done' }))).not.toThrow()
  })
})

describe('useUploadCompletionRefresh (wiring)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useTransferQueue.setState({ transfers: [] })
  })

  afterEach(() => {
    useTransferQueue.setState({ transfers: [] })
    vi.useRealTimers()
  })

  it('refreshes when a real store update lands a transfer on done', () => {
    // The point of this case: the pure-function tests above can all pass while the
    // subscription is missing. Removing `useTransferQueue.subscribe` makes this red.
    const loadDir = vi.fn()
    renderHook(() =>
      useUploadCompletionRefresh({
        sessionId: 's1',
        remoteDir: '/srv/dir',
        loadDir,
      }),
    )

    act(() => {
      useTransferQueue.setState({ transfers: [record({ id: 't1', status: 'running' })] })
    })
    expect(loadDir).not.toHaveBeenCalled()

    act(() => {
      useTransferQueue.setState({
        transfers: [record({ id: 't1', status: 'done' })],
      })
    })
    act(() => {
      vi.advanceTimersByTime(COALESCE)
    })
    expect(loadDir).toHaveBeenCalledTimes(1)
    expect(loadDir).toHaveBeenCalledWith('/srv/dir')
  })

  it('refreshes once per batch even as every file settles', () => {
    const loadDir = vi.fn()
    renderHook(() =>
      useUploadCompletionRefresh({ sessionId: 's1', remoteDir: '/srv/dir', loadDir }),
    )

    act(() => {
      useTransferQueue.setState({
        transfers: [
          record({ id: 'a', status: 'done' }),
          record({ id: 'b', status: 'done' }),
          record({ id: 'c', status: 'done' }),
        ],
      })
    })
    act(() => {
      vi.advanceTimersByTime(COALESCE)
    })
    // One update carrying three `done` records is one listing.
    expect(loadDir).toHaveBeenCalledTimes(1)
  })

  it('stops refreshing after unmount', () => {
    const loadDir = vi.fn()
    const { unmount } = renderHook(() =>
      useUploadCompletionRefresh({ sessionId: 's1', remoteDir: '/srv/dir', loadDir }),
    )
    unmount()

    act(() => {
      useTransferQueue.setState({ transfers: [record({ id: 't1', status: 'done' })] })
    })
    act(() => {
      vi.advanceTimersByTime(COALESCE * 4)
    })
    expect(loadDir).not.toHaveBeenCalled()
  })

  it('does not subscribe at all without a session', () => {
    const loadDir = vi.fn()
    renderHook(() => useUploadCompletionRefresh(null))
    act(() => {
      useTransferQueue.setState({ transfers: [record({ id: 't1', status: 'done' })] })
    })
    act(() => {
      vi.advanceTimersByTime(COALESCE * 4)
    })
    expect(loadDir).not.toHaveBeenCalled()
  })
})
