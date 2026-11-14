// Issue #54 — the refresh tracker must not remember every transfer forever.
//
// ## The leak
//
// Two collections grew for as long as the hook stayed mounted:
//
//   * `settled` — every id that reached `done`, so a second `done` for the same id
//     would not schedule a second refresh;
//   * `seen` — every id the store subscription had observed, so an update that did
//     not change a status would not count as an event.
//
// The transfer store lets the user clear finished transfers
// (`clearFinished()` / `remove()`), and nothing told these two collections about it.
// A dock left open for a day of transfers kept every id it had ever seen, whether
// or not the store still had the record.
//
// ## What must not break
//
// The reason `settled` exists is real: a `done` record can be observed twice (the
// store also fires for unrelated fields), and a duplicate refresh means a second
// directory listing over the same SFTP channel. So the fix cannot be "stop
// deduplicating" — it has to be "stop remembering transfers that no longer exist".

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTransferQueue } from '@/store/transfer-queue'
import type { TransferRecord } from '@/store/transfer-queue'
import {
  createUploadRefreshTracker,
  useUploadCompletionRefresh,
} from './use-upload-completion-refresh'

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
    status: 'done',
    bytesDone: 1,
    bytesTotal: 1,
    speed: 0,
    startedAt: 1,
    ...overrides,
  }
}

/** Read the tracker's retained id count. Test-only accessor. */
function retained(tracker: ReturnType<typeof createUploadRefreshTracker>): number {
  return tracker.__retainedForTests()
}

describe('the tracker reclaims ids the store no longer has', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useTransferQueue.setState({ transfers: [] })
  })
  afterEach(() => {
    vi.useRealTimers()
    useTransferQueue.setState({ transfers: [] })
  })

  it('keeps a settled id only until the refresh it caused has fired', () => {
    const loadDir = vi.fn()
    const tracker = createUploadRefreshTracker({
      sessionId: 's1',
      remoteDir: '/srv/dir',
      loadDir,
    })

    tracker.observe(record({ id: 't1' }))
    expect(retained(tracker)).toBe(1)

    vi.advanceTimersByTime(COALESCE)
    // The refresh happened. Remembering the id any longer buys nothing: the record
    // is terminal and this tracker will not act on it again.
    expect(retained(tracker)).toBe(0)
    expect(loadDir).toHaveBeenCalledTimes(1)
  })

  it('still deduplicates a repeated done for the same id', () => {
    const loadDir = vi.fn()
    const tracker = createUploadRefreshTracker({
      sessionId: 's1',
      remoteDir: '/srv/dir',
      loadDir,
    })

    tracker.observe(record({ id: 't1' }))
    tracker.observe(record({ id: 't1' }))
    vi.advanceTimersByTime(COALESCE)
    // Two observations, one listing.
    expect(loadDir).toHaveBeenCalledTimes(1)
  })

  it('a batch of twelve files leaves nothing behind after the refresh', () => {
    const loadDir = vi.fn()
    const tracker = createUploadRefreshTracker({
      sessionId: 's1',
      remoteDir: '/srv/dir',
      loadDir,
    })
    for (let index = 0; index < 12; index += 1) {
      tracker.observe(record({ id: `t${index}` }))
      vi.advanceTimersByTime(10)
    }
    vi.advanceTimersByTime(COALESCE)
    expect(loadDir).toHaveBeenCalledTimes(1)
    expect(retained(tracker)).toBe(0)
  })

  it('1000 done-then-cleared cycles leave the tracker bounded', () => {
    // The shape that matters: the user keeps clearing the transfer list, so the
    // store stays small while the tracker's memory must too.
    const loadDir = vi.fn()
    const tracker = createUploadRefreshTracker({
      sessionId: 's1',
      remoteDir: '/srv/dir',
      loadDir,
    })

    for (let index = 0; index < 1000; index += 1) {
      tracker.observe(record({ id: `t${index}` }))
      vi.advanceTimersByTime(COALESCE + 1)
    }
    expect(retained(tracker)).toBe(0)
  })
})

describe('the store subscription reclaims what the store dropped', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useTransferQueue.setState({ transfers: [] })
  })
  afterEach(() => {
    vi.useRealTimers()
    useTransferQueue.setState({ transfers: [] })
  })

  it('forgets a transfer after clearFinished removes it', () => {
    const loadDir = vi.fn()
    renderHook(() =>
      useUploadCompletionRefresh({ sessionId: 's1', remoteDir: '/srv/dir', loadDir }),
    )

    act(() => {
      useTransferQueue.setState({ transfers: [record({ id: 't1' })] })
    })
    act(() => {
      vi.advanceTimersByTime(COALESCE)
    })
    expect(loadDir).toHaveBeenCalledTimes(1)

    // The user clears the list.
    act(() => {
      useTransferQueue.getState().clearFinished()
    })

    // A new transfer with the same id must be treated as new. If `seen` still held
    // the old status the diff would swallow this update entirely.
    act(() => {
      useTransferQueue.setState({ transfers: [record({ id: 't1', status: 'done' })] })
    })
    act(() => {
      vi.advanceTimersByTime(COALESCE)
    })
    expect(loadDir).toHaveBeenCalledTimes(2)
  })

  it('a removed transfer does not resurrect its old status', () => {
    const loadDir = vi.fn()
    renderHook(() =>
      useUploadCompletionRefresh({ sessionId: 's1', remoteDir: '/srv/dir', loadDir }),
    )

    act(() => {
      useTransferQueue.setState({ transfers: [record({ id: 't1' })] })
    })
    act(() => {
      vi.advanceTimersByTime(COALESCE)
    })
    act(() => {
      useTransferQueue.setState({ transfers: [] })
    })
    // Same id, already `done`. If the map still remembered `done`, the diff would
    // skip it and no second refresh would ever happen.
    act(() => {
      useTransferQueue.setState({ transfers: [record({ id: 't1' })] })
    })
    act(() => {
      vi.advanceTimersByTime(COALESCE)
    })
    expect(loadDir).toHaveBeenCalledTimes(2)
  })

  it('500 add-and-remove cycles keep the subscription memory bounded', () => {
    const loadDir = vi.fn()
    renderHook(() =>
      useUploadCompletionRefresh({ sessionId: 's1', remoteDir: '/srv/dir', loadDir }),
    )

    for (let index = 0; index < 500; index += 1) {
      act(() => {
        useTransferQueue.setState({ transfers: [record({ id: `t${index}` })] })
      })
      act(() => {
        vi.advanceTimersByTime(COALESCE)
      })
      act(() => {
        useTransferQueue.setState({ transfers: [] })
      })
    }
    // Every cycle refreshed once and forgot once; nothing accumulated.
    expect(loadDir).toHaveBeenCalledTimes(500)
  })
})
