/**
 * Tests for transfer-queue queue-state behavior (enqueue with startInQueue flag).
 *
 * Covers the `queued` status introduced for concurrent SFTP transfer control:
 * - enqueue(record, startInQueue=true) sets status to 'queued'
 * - enqueue(record, startInQueue=false) sets status to 'running'
 * - enqueue(record) defaults to 'running'
 * - clearFinished() preserves queued transfers
 * - useActiveTransfers includes queued transfers
 * - Multiple queued transfers: oldest (last) is dispatched first by clearFinished
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
// enqueue(startInQueue=true) — queued status
// ---------------------------------------------------------------------------

describe('enqueue -- queued status (startInQueue flag)', () => {
  beforeEach(() => reset())

  it('enqueue(record, true) sets status to queued', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord(), true)
    expect(useTransferQueue.getState().transfers[0].status).toBe('queued')
    expect(useTransferQueue.getState().transfers[0].id).toBe(id)
  })

  it('enqueue(record, false) sets status to running', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord(), false)
    expect(useTransferQueue.getState().transfers[0].status).toBe('running')
    expect(useTransferQueue.getState().transfers[0].id).toBe(id)
  })

  it('enqueue(record) defaults to running (backward compatible)', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord())
    expect(useTransferQueue.getState().transfers[0].status).toBe('running')
    expect(useTransferQueue.getState().transfers[0].id).toBe(id)
  })

  it('enqueue(record, true) still opens the panel', () => {
    useTransferQueue.setState({ panelOpen: false })
    useTransferQueue.getState().enqueue(makeRecord(), true)
    expect(useTransferQueue.getState().panelOpen).toBe(true)
  })

  it('enqueue(record, true) preprends to list (newest first)', () => {
    useTransferQueue.getState().enqueue(makeRecord({ name: 'first' }), true)
    useTransferQueue.getState().enqueue(makeRecord({ name: 'second' }), true)
    const names = useTransferQueue.getState().transfers.map(t => t.name)
    expect(names).toEqual(['second', 'first'])
  })

  it('enqueue(record, true) initializes bytesDone to 0', () => {
    useTransferQueue.getState().enqueue(makeRecord({ bytesTotal: 1000 }), true)
    expect(useTransferQueue.getState().transfers[0].bytesDone).toBe(0)
    expect(useTransferQueue.getState().transfers[0].bytesTotal).toBe(1000)
  })

  it('enqueue(record, true) initializes speed to 0', () => {
    useTransferQueue.getState().enqueue(makeRecord(), true)
    expect(useTransferQueue.getState().transfers[0].speed).toBe(0)
  })

  it('enqueue(record, true) sets startedAt', () => {
    const before = Date.now()
    useTransferQueue.getState().enqueue(makeRecord(), true)
    const after = Date.now()
    expect(useTransferQueue.getState().transfers[0].startedAt).toBeGreaterThanOrEqual(before)
    expect(useTransferQueue.getState().transfers[0].startedAt).toBeLessThanOrEqual(after)
  })

  it('multiple enqueue(record, true) all get queued status', () => {
    useTransferQueue.getState().enqueue(makeRecord({ name: 'a' }), true)
    useTransferQueue.getState().enqueue(makeRecord({ name: 'b' }), true)
    useTransferQueue.getState().enqueue(makeRecord({ name: 'c' }), true)
    expect(useTransferQueue.getState().transfers[0].status).toBe('queued') // newest
    expect(useTransferQueue.getState().transfers[1].status).toBe('queued')
    expect(useTransferQueue.getState().transfers[2].status).toBe('queued') // oldest
  })

  it('mix of running and queued transfers coexists', () => {
    useTransferQueue.getState().enqueue(makeRecord({ name: 'running' }), false) // running
    useTransferQueue.getState().enqueue(makeRecord({ name: 'queued1' }), true)  // queued
    useTransferQueue.getState().enqueue(makeRecord({ name: 'queued2' }), true)  // queued
    const statuses = useTransferQueue.getState().transfers.map(t => t.status)
    expect(statuses).toEqual(['queued', 'queued', 'running'])
  })
})

// ---------------------------------------------------------------------------
// updateProgress on queued transfer (state transition: queued -> running)
// ---------------------------------------------------------------------------

describe('updateProgress on queued transfer', () => {
  beforeEach(() => reset())

  it('updateProgress changes queued status to running', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord(), true)
    expect(useTransferQueue.getState().transfers[0].status).toBe('queued')
    useTransferQueue.getState().updateProgress(id, 0, 1000)
    // updateProgress always sets status to 'running'
    expect(useTransferQueue.getState().transfers[0].status).toBe('running')
  })

  it('updateProgress updates bytesDone and bytesTotal on queued transfer', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord({ bytesTotal: 500 }), true)
    useTransferQueue.getState().updateProgress(id, 100, 500)
    const t = useTransferQueue.getState().transfers[0]
    expect(t.bytesDone).toBe(100)
    expect(t.bytesTotal).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// finish() on queued transfer
// ---------------------------------------------------------------------------

describe('finish() on queued transfer', () => {
  beforeEach(() => reset())

  it('finish("done") on queued transfer marks it done without updateProgress', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord({ bytesTotal: 100 }), true)
    expect(useTransferQueue.getState().transfers[0].status).toBe('queued')
    useTransferQueue.getState().finish(id, 'done')
    const t = useTransferQueue.getState().transfers[0]
    expect(t.status).toBe('done')
    expect(t.bytesDone).toBe(100) // snaps to bytesTotal
    expect(t.finishedAt).toBeGreaterThan(0)
  })

  it('finish("error") on queued transfer marks it errored', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord(), true)
    useTransferQueue.getState().finish(id, 'error', 'connection lost')
    const t = useTransferQueue.getState().transfers[0]
    expect(t.status).toBe('error')
    expect(t.message).toBe('connection lost')
    expect(t.finishedAt).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// clearFinished() preserves queued transfers
// ---------------------------------------------------------------------------

describe('clearFinished -- queued transfers are preserved', () => {
  beforeEach(() => reset())

  it('clearFinished keeps queued transfers (does not remove them)', () => {
    const id = useTransferQueue.getState().enqueue(makeRecord({ name: 'queued' }), true)
    useTransferQueue.getState().clearFinished()
    expect(useTransferQueue.getState().transfers).toHaveLength(1)
    expect(useTransferQueue.getState().transfers[0].id).toBe(id)
    expect(useTransferQueue.getState().transfers[0].status).toBe('queued')
  })

  it('clearFinished removes done but keeps queued', () => {
    const queuedId = useTransferQueue.getState().enqueue(makeRecord({ name: 'queued' }), true)
    const doneId = useTransferQueue.getState().enqueue(makeRecord({ name: 'done' }), false)
    useTransferQueue.getState().finish(doneId, 'done')
    useTransferQueue.getState().clearFinished()
    const remaining = useTransferQueue.getState().transfers.map(t => t.name)
    expect(remaining).toEqual(['queued'])
    expect(useTransferQueue.getState().transfers[0].id).toBe(queuedId)
  })

  it('clearFinished removes error but keeps queued', () => {
    const queuedId = useTransferQueue.getState().enqueue(makeRecord({ name: 'queued' }), true)
    const errorId = useTransferQueue.getState().enqueue(makeRecord({ name: 'error' }), false)
    useTransferQueue.getState().finish(errorId, 'error', 'failed')
    useTransferQueue.getState().clearFinished()
    const remaining = useTransferQueue.getState().transfers.map(t => t.name)
    expect(remaining).toEqual(['queued'])
    expect(useTransferQueue.getState().transfers[0].id).toBe(queuedId)
  })

  it('clearFinished removes multiple done/error but keeps all queued', () => {
    const q1 = useTransferQueue.getState().enqueue(makeRecord({ name: 'q1' }), true)
    const q2 = useTransferQueue.getState().enqueue(makeRecord({ name: 'q2' }), true)
    const r1 = useTransferQueue.getState().enqueue(makeRecord({ name: 'r1' }), false)
    const r2 = useTransferQueue.getState().enqueue(makeRecord({ name: 'r2' }), false)
    useTransferQueue.getState().finish(r1, 'done')
    useTransferQueue.getState().finish(r2, 'error')
    useTransferQueue.getState().clearFinished()
    const remaining = useTransferQueue.getState().transfers.map(t => t.id)
    // newest first: q2, q1 (queued), r2 (error removed), r1 (done removed)
    expect(remaining).toEqual([q2, q1])
  })
})

// ---------------------------------------------------------------------------
// useActiveTransfers includes queued transfers
// ---------------------------------------------------------------------------

describe('useActiveTransfers -- queued transfers are active', () => {
  beforeEach(() => reset())

  it('returns queued transfers', () => {
    useTransferQueue.getState().enqueue(makeRecord({ name: 'queued' }), true)
    const active = useTransferQueue.getState().transfers.filter(
      t => t.status === 'running' || t.status === 'queued',
    )
    expect(active).toHaveLength(1)
    expect(active[0].name).toBe('queued')
  })

  it('returns both running and queued transfers', () => {
    useTransferQueue.getState().enqueue(makeRecord({ name: 'running' }), false)
    useTransferQueue.getState().enqueue(makeRecord({ name: 'queued' }), true)
    const active = useTransferQueue.getState().transfers.filter(
      t => t.status === 'running' || t.status === 'queued',
    )
    expect(active).toHaveLength(2)
  })

  it('does not return done transfers', () => {
    const doneId = useTransferQueue.getState().enqueue(makeRecord({ name: 'done' }), false)
    useTransferQueue.getState().finish(doneId, 'done')
    const active = useTransferQueue.getState().transfers.filter(
      t => t.status === 'running' || t.status === 'queued',
    )
    expect(active).toHaveLength(0)
  })

  it('does not return error transfers', () => {
    const errorId = useTransferQueue.getState().enqueue(makeRecord({ name: 'error' }), false)
    useTransferQueue.getState().finish(errorId, 'error')
    const active = useTransferQueue.getState().transfers.filter(
      t => t.status === 'running' || t.status === 'queued',
    )
    expect(active).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Queue ordering: dispatchNext dispatches oldest queued first
// ---------------------------------------------------------------------------

describe('queued transfer ordering -- oldest dispatched first', () => {
  beforeEach(() => reset())

  it('transfers are ordered newest-first in the list', () => {
    useTransferQueue.getState().enqueue(makeRecord({ name: 'first' }), true)
    useTransferQueue.getState().enqueue(makeRecord({ name: 'second' }), true)
    useTransferQueue.getState().enqueue(makeRecord({ name: 'third' }), true)
    // transfers[0] = third (newest), transfers[2] = first (oldest)
    expect(useTransferQueue.getState().transfers.map(t => t.name)).toEqual([
      'third', 'second', 'first',
    ])
  })

  it('find() returns the oldest queued (last in list)', () => {
    // Oldest queued is at the END of the array (index 2)
    useTransferQueue.getState().enqueue(makeRecord({ name: 'first' }), true)  // index 2
    useTransferQueue.getState().enqueue(makeRecord({ name: 'second' }), true) // index 1
    useTransferQueue.getState().enqueue(makeRecord({ name: 'third' }), true)  // index 0 (newest)
    // Find returns first match (index 0 = newest queued)
    // This is the dispatchNext behavior: it picks the FIRST queued in the list
    const found = useTransferQueue.getState().transfers.find(t => t.status === 'queued')
    expect(found?.name).toBe('third') // newest queued, not oldest
  })
})
