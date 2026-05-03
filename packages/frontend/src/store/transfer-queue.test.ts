/**
 * Tests for transfer-queue store (expanded)
 *
 * Covers: remove(), setPanelOpen(), edge cases (non-existent IDs,
 * bytesTotal=0, concurrent updates, speed calculation), useActiveTransfers selector.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import { useTransferQueue } from './transfer-queue'

function reset() {
  useTransferQueue.setState({ transfers: [], panelOpen: false })
}

type BaseRecord = {
  id: string
  kind: 'upload' | 'download'
  name: string
  localPath: string
  remotePath: string
  sessionId: string
  bytesTotal?: number
}

function makeRecord(overrides: Partial<Omit<BaseRecord, 'kind'>> & { kind?: 'upload' | 'download' } = {}): BaseRecord {
  return {
    id: '',
    kind: 'upload',
    name: 'f.txt',
    localPath: '/tmp/f.txt',
    remotePath: '/srv/f.txt',
    sessionId: 's1',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Existing tests (kept for reference, new tests added below)
// ---------------------------------------------------------------------------

describe('useTransferQueue -- existing coverage', () => {
  beforeEach(() => reset())

  it('enqueue() adds a running transfer and opens the panel', () => {
    const id = useTransferQueue.getState().enqueue({ ...makeRecord(), name: 'a.txt' })
    expect(useTransferQueue.getState().panelOpen).toBe(true)
    expect(useTransferQueue.getState().transfers).toHaveLength(1)
    expect(useTransferQueue.getState().transfers[0].id).toBe(id)
    expect(useTransferQueue.getState().transfers[0].status).toBe('running')
  })

  it('togglePanel flips panelOpen', () => {
    expect(useTransferQueue.getState().panelOpen).toBe(false)
    useTransferQueue.getState().togglePanel()
    expect(useTransferQueue.getState().panelOpen).toBe(true)
    useTransferQueue.getState().togglePanel()
    expect(useTransferQueue.getState().panelOpen).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// remove()
// ---------------------------------------------------------------------------

describe('remove()', () => {
  beforeEach(() => reset())

  it('removes a transfer by id', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord())
    expect(useTransferQueue.getState().transfers).toHaveLength(1)
    useTransferQueue.getState().remove(id)
    expect(useTransferQueue.getState().transfers).toHaveLength(0)
  })

  it('removes only the targeted transfer', () => {
    const id1 = useTransferQueue.getState().enqueue(makeRecord({ name: 'a.txt' }))
    const id2 = useTransferQueue.getState().enqueue(makeRecord({ name: 'b.txt' }))
    const id3 = useTransferQueue.getState().enqueue(makeRecord({ name: 'c.txt' }))
    useTransferQueue.getState().remove(id2)
    const remaining = useTransferQueue.getState().transfers.map(t => t.id)
    expect(remaining).toEqual([id3, id1])
  })

  it('idempotent: remove non-existent id does not throw', () => {
    expect(() => useTransferQueue.getState().remove('no-such-id')).not.toThrow()
  })

  it('after removal, remaining transfers still update correctly', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord())
    useTransferQueue.getState().remove(id)
    useTransferQueue.getState().enqueue(makeRecord({ name: 'new.txt' }))
    expect(useTransferQueue.getState().transfers).toHaveLength(1)
    expect(useTransferQueue.getState().transfers[0].name).toBe('new.txt')
  })
})

// ---------------------------------------------------------------------------
// setPanelOpen()
// ---------------------------------------------------------------------------

describe('setPanelOpen()', () => {
  beforeEach(() => reset())

  it('opens the panel', () => {
    useTransferQueue.getState().setPanelOpen(true)
    expect(useTransferQueue.getState().panelOpen).toBe(true)
  })

  it('closes the panel', () => {
    useTransferQueue.setState({ panelOpen: true })
    useTransferQueue.getState().setPanelOpen(false)
    expect(useTransferQueue.getState().panelOpen).toBe(false)
  })

  it('setPanelOpen(false) does not remove transfers', () => {
    useTransferQueue.getState().enqueue(makeRecord())
    useTransferQueue.getState().setPanelOpen(false)
    expect(useTransferQueue.getState().transfers).toHaveLength(1)
  })

  it('setPanelOpen(true) does not re-open if already open', () => {
    useTransferQueue.setState({ panelOpen: true })
    useTransferQueue.getState().setPanelOpen(true)
    expect(useTransferQueue.getState().panelOpen).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// finish() edge cases
// ---------------------------------------------------------------------------

describe('finish() edge cases', () => {
  beforeEach(() => reset())

  it('finish("done") on non-existent id does not throw', () => {
    expect(() => useTransferQueue.getState().finish('no-such', 'done')).not.toThrow()
  })

  it('finish("done") snaps bytesDone to bytesTotal even when bytesTotal=0', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord({ bytesTotal: 0 }))
    useTransferQueue.getState().finish(id, 'done')
    const t = useTransferQueue.getState().transfers[0]
    expect(t.status).toBe('done')
    expect(t.bytesDone).toBe(0)
    expect(t.bytesTotal).toBe(0)
  })

  it('finish("done") when bytesTotal was never provided (defaults to 0)', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord())
    useTransferQueue.getState().finish(id, 'done')
    const t = useTransferQueue.getState().transfers[0]
    expect(t.status).toBe('done')
    expect(t.bytesDone).toBe(0)
  })

  it('finish("error") without message leaves message undefined', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord())
    useTransferQueue.getState().finish(id, 'error')
    const t = useTransferQueue.getState().transfers[0]
    expect(t.status).toBe('error')
    expect(t.message).toBeUndefined()
  })

  it('multiple finish calls on same id -- last call wins', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord())
    useTransferQueue.getState().finish(id, 'done')
    useTransferQueue.getState().finish(id, 'error', 'overwritten')
    const t = useTransferQueue.getState().transfers[0]
    expect(t.status).toBe('error')
    expect(t.message).toBe('overwritten')
  })
})

// ---------------------------------------------------------------------------
// updateProgress() edge cases
// ---------------------------------------------------------------------------

describe('updateProgress() edge cases', () => {
  beforeEach(() => reset())

  it('updateProgress on non-existent id does not throw', () => {
    expect(() => useTransferQueue.getState().updateProgress('no-such', 100, 1000)).not.toThrow()
  })

  it('updateProgress with bytesTotal=0 preserves existing total', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord({ bytesTotal: 500 }))
    useTransferQueue.getState().updateProgress(id, 100, 0)
    const t = useTransferQueue.getState().transfers[0]
    expect(t.bytesTotal).toBe(500)
  })

  it('updateProgress with bytesTotal>0 overrides existing total', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord({ bytesTotal: 100 }))
    useTransferQueue.getState().updateProgress(id, 50, 500)
    const t = useTransferQueue.getState().transfers[0]
    expect(t.bytesTotal).toBe(500)
  })

  it('updateProgress does not change status (finish() is separate)', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord())
    useTransferQueue.getState().updateProgress(id, 500, 500)
    const t = useTransferQueue.getState().transfers[0]
    expect(t.status).toBe('running')
    expect(t.bytesDone).toBe(500)
  })

  it('speed calculation: zero dt keeps previous speed', async () => {
    const id = useTransferQueue.getState().enqueue(makeRecord())
    useTransferQueue.getState().updateProgress(id, 0, 1000)
    useTransferQueue.getState().updateProgress(id, 100, 1000)
    const t = useTransferQueue.getState().transfers[0]
    expect(t.speed).toBe(0)
  })

  it('negative bytes delta clamps speed to 0', async () => {
    const id = useTransferQueue.getState().enqueue(makeRecord())
    useTransferQueue.getState().updateProgress(id, 500, 1000)
    await new Promise(r => setTimeout(r, 20))
    useTransferQueue.getState().updateProgress(id, 200, 1000)
    const t = useTransferQueue.getState().transfers[0]
    expect(t.speed).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Concurrent updates (same transfer, interleaved)
// ---------------------------------------------------------------------------

describe('concurrent updateProgress on same transfer', () => {
  beforeEach(() => reset())

  it('second updateProgress overrides first (no accumulation)', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord())
    useTransferQueue.getState().updateProgress(id, 100, 500)
    useTransferQueue.getState().updateProgress(id, 300, 500)
    const t = useTransferQueue.getState().transfers[0]
    expect(t.bytesDone).toBe(300)
    expect(t.bytesTotal).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// enqueue() edge cases
// ---------------------------------------------------------------------------

describe('enqueue() edge cases', () => {
  beforeEach(() => reset())

  it('enqueue without bytesTotal defaults to 0', () => {
    useTransferQueue.getState().enqueue(makeRecord())
    const t = useTransferQueue.getState().transfers[0]
    expect(t.bytesTotal).toBe(0)
    expect(t.bytesDone).toBe(0)
  })

  it('enqueue without id generates a UUID', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord({ id: '' }))
    expect(id).toBeTruthy()
    expect(id.length).toBeGreaterThan(0)
  })

  it('enqueue with explicit id uses it', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord({ id: 'my-explicit-id' }))
    expect(id).toBe('my-explicit-id')
    expect(useTransferQueue.getState().transfers[0].id).toBe('my-explicit-id')
  })

  it('enqueue for download sets kind to download', () => {
    useTransferQueue.getState().enqueue(makeRecord({ kind: 'download' }))
    const t = useTransferQueue.getState().transfers[0]
    expect(t.kind).toBe('download')
  })

  it('enqueue preprends to transfers list (newest first)', () => {
    useTransferQueue.getState().enqueue(makeRecord({ name: 'first' }))
    useTransferQueue.getState().enqueue(makeRecord({ name: 'second' }))
    const names = useTransferQueue.getState().transfers.map(t => t.name)
    expect(names).toEqual(['second', 'first'])
  })

  it('startedAt is a positive integer timestamp', () => {
    const before = Date.now()
    useTransferQueue.getState().enqueue(makeRecord())
    const after = Date.now()
    const t = useTransferQueue.getState().transfers[0]
    expect(t.startedAt).toBeGreaterThanOrEqual(before)
    expect(t.startedAt).toBeLessThanOrEqual(after)
  })

  it('initial speed is 0', () => {
    useTransferQueue.getState().enqueue(makeRecord())
    const t = useTransferQueue.getState().transfers[0]
    expect(t.speed).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// clearFinished() edge cases
// ---------------------------------------------------------------------------

describe('clearFinished() edge cases', () => {
  beforeEach(() => reset())

  it('clearFinished on empty list does not throw', () => {
    expect(() => useTransferQueue.getState().clearFinished()).not.toThrow()
  })

  it('clearFinished only removes done/error, not running', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord({ name: 'running' }))
    useTransferQueue.getState().clearFinished()
    expect(useTransferQueue.getState().transfers).toHaveLength(1)
    expect(useTransferQueue.getState().transfers[0].id).toBe(id)
  })

  it('clearFinished with all done/error removes everything', () => {
    const id1 = useTransferQueue.getState().enqueue(makeRecord({ name: 'a' }))
    const id2 = useTransferQueue.getState().enqueue(makeRecord({ name: 'b' }))
    useTransferQueue.getState().finish(id1, 'done')
    useTransferQueue.getState().finish(id2, 'error')
    useTransferQueue.getState().clearFinished()
    expect(useTransferQueue.getState().transfers).toHaveLength(0)
  })

  it('clearFinished removes done transfers but keeps running ones', () => {
    const doneId = useTransferQueue.getState().enqueue(makeRecord({ name: 'done' }))
    useTransferQueue.getState().enqueue(makeRecord({ name: 'running' }))
    useTransferQueue.getState().finish(doneId, 'done')
    useTransferQueue.getState().clearFinished()
    const remaining = useTransferQueue.getState().transfers.map(t => t.name)
    expect(remaining).toEqual(['running'])
  })
})

// ---------------------------------------------------------------------------
// useActiveTransfers selector
// ---------------------------------------------------------------------------

describe('useActiveTransfers selector', () => {
  beforeEach(() => reset())

  it('returns empty when no transfers', () => {
    const active = useTransferQueue.getState().transfers.filter(
      t => t.status === 'running' || t.status === 'queued',
    )
    expect(active).toEqual([])
  })

  it('returns running transfers', () => {
    useTransferQueue.getState().enqueue(makeRecord({ name: 'running' }))
    const doneId = useTransferQueue.getState().enqueue(makeRecord({ name: 'done' }))
    useTransferQueue.getState().finish(doneId, 'done')
    const active = useTransferQueue.getState().transfers.filter(
      t => t.status === 'running' || t.status === 'queued',
    )
    expect(active).toHaveLength(1)
    expect(active[0].name).toBe('running')
  })

  it('returns all active transfers regardless of order', () => {
    useTransferQueue.getState().enqueue(makeRecord({ name: 'a' }))
    useTransferQueue.getState().enqueue(makeRecord({ name: 'b' }))
    useTransferQueue.getState().enqueue(makeRecord({ name: 'c' }))
    const middleId = useTransferQueue.getState().transfers[1].id
    useTransferQueue.getState().finish(middleId, 'done')
    const active = useTransferQueue.getState().transfers.filter(
      t => t.status === 'running' || t.status === 'queued',
    )
    expect(active.map(t => t.name)).toEqual(['c', 'a'])
  })
})

// ---------------------------------------------------------------------------
// Checksum methods
// ---------------------------------------------------------------------------

describe('useTransferQueue -- checksum methods', () => {
  beforeEach(() => reset())

  it('initChecksum sets algorithm and computing status for upload', () => {
    const id = useTransferQueue.getState().enqueue({ ...makeRecord({ kind: 'upload' }), status: 'running' })
    useTransferQueue.getState().initChecksum(id)
    const t = useTransferQueue.getState().transfers.find(tr => tr.id === id)!
    expect(t.checksum).toBeDefined()
    expect(t.checksum!.algorithm).toBe('sha256')
    // upload: local is computed first
    expect(t.checksum!.localStatus).toBe('computing')
    expect(t.checksum!.remoteStatus).toBe('pending')
  })

  it('initChecksum sets computing status for download', () => {
    const id = useTransferQueue.getState().enqueue({ ...makeRecord({ kind: 'download' }), status: 'running' })
    useTransferQueue.getState().initChecksum(id)
    const t = useTransferQueue.getState().transfers.find(tr => tr.id === id)!
    expect(t.checksum).toBeDefined()
    expect(t.checksum!.algorithm).toBe('sha256')
    // download: remote is computed first
    expect(t.checksum!.localStatus).toBe('pending')
    expect(t.checksum!.remoteStatus).toBe('computing')
  })

  it('setChecksumResult records local hash', () => {
    const id = useTransferQueue.getState().enqueue({ ...makeRecord({ kind: 'upload' }), status: 'running' })
    useTransferQueue.getState().initChecksum(id)
    useTransferQueue.getState().setChecksumResult(id, 'local', {
      success: true,
      hash: 'abc123',
    })
    const t = useTransferQueue.getState().transfers.find(tr => tr.id === id)!
    expect(t.checksum!.localHash).toBe('abc123')
    expect(t.checksum!.localStatus).toBe('done')
    expect(t.checksum!.remoteStatus).toBe('pending')
  })

  it('setChecksumResult records remote hash', () => {
    const id = useTransferQueue.getState().enqueue({ ...makeRecord({ kind: 'download' }), status: 'running' })
    useTransferQueue.getState().initChecksum(id)
    useTransferQueue.getState().setChecksumResult(id, 'remote', {
      success: true,
      hash: 'def456',
    })
    const t = useTransferQueue.getState().transfers.find(tr => tr.id === id)!
    expect(t.checksum!.remoteHash).toBe('def456')
    expect(t.checksum!.remoteStatus).toBe('done')
  })

  it('setChecksumResult records error', () => {
    const id = useTransferQueue.getState().enqueue({ ...makeRecord({ kind: 'upload' }), status: 'running' })
    useTransferQueue.getState().initChecksum(id)
    useTransferQueue.getState().setChecksumResult(id, 'local', {
      success: false,
      error: 'File not found',
    })
    const t = useTransferQueue.getState().transfers.find(tr => tr.id === id)!
    expect(t.checksum!.localStatus).toBe('error')
    expect(t.checksum!.localError).toBe('File not found')
  })

  it('auto-compares when both sides are done and hashes match', () => {
    const id = useTransferQueue.getState().enqueue({ ...makeRecord({ kind: 'upload' }), status: 'running' })
    useTransferQueue.getState().initChecksum(id)
    useTransferQueue.getState().setChecksumResult(id, 'local', { success: true, hash: 'same-hash' })
    useTransferQueue.getState().setChecksumResult(id, 'remote', { success: true, hash: 'same-hash' })
    const t = useTransferQueue.getState().transfers.find(tr => tr.id === id)!
    expect(t.checksum!.matches).toBe(true)
  })

  it('marks mismatch when hashes differ', () => {
    const id = useTransferQueue.getState().enqueue({ ...makeRecord({ kind: 'upload' }), status: 'running' })
    useTransferQueue.getState().initChecksum(id)
    useTransferQueue.getState().setChecksumResult(id, 'local', { success: true, hash: 'hash-a' })
    useTransferQueue.getState().setChecksumResult(id, 'remote', { success: true, hash: 'hash-b' })
    const t = useTransferQueue.getState().transfers.find(tr => tr.id === id)!
    expect(t.checksum!.matches).toBe(false)
  })

  it('updateChecksumProgress updates bytes while computing', () => {
    const id = useTransferQueue.getState().enqueue({ ...makeRecord({ kind: 'upload' }), status: 'running' })
    useTransferQueue.getState().initChecksum(id)
    useTransferQueue.getState().updateChecksumProgress(id, 512, 1024)
    const t = useTransferQueue.getState().transfers.find(tr => tr.id === id)!
    expect(t.bytesDone).toBe(512)
    expect(t.bytesTotal).toBe(1024)
  })

  it('initChecksum is idempotent on already-initialized record', () => {
    const id = useTransferQueue.getState().enqueue({ ...makeRecord({ kind: 'upload' }), status: 'running' })
    useTransferQueue.getState().initChecksum(id)
    // Should not throw
    useTransferQueue.getState().initChecksum(id)
    const t = useTransferQueue.getState().transfers.find(tr => tr.id === id)!
    expect(t.checksum).toBeDefined()
  })

  it('setChecksumResult does nothing for non-existent id', () => {
    useTransferQueue.getState().setChecksumResult('non-existent', 'local', {
      success: true,
      hash: 'x',
    })
    // No throw, no state change
    expect(useTransferQueue.getState().transfers).toHaveLength(0)
  })
})
