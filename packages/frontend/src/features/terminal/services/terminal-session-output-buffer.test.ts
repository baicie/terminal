import { describe, expect, it, vi } from 'vitest'
import {
  TerminalSessionAudience,
  TerminalSessionOutputBuffer,
} from './terminal-session-output-buffer'
import type {
  TerminalOutputReceipt,
  TerminalSessionListener,
  TerminalSessionSnapshot,
} from './terminal-session-manager-types'

function output(sessionId: string, data = sessionId) {
  return {
    session_id: sessionId,
    data,
    is_stderr: false,
  }
}

describe('TerminalSessionOutputBuffer', () => {
  it('bounds pending output by evicting the oldest unknown session', () => {
    const buffer = new TerminalSessionOutputBuffer()

    for (let index = 0; index < 1024; index += 1) {
      buffer.add(output(`session-${index}`))
    }
    buffer.add(output('session-1024'))

    expect(buffer.take('session-0')).toEqual([])
    expect(buffer.take('session-1')).toEqual([output('session-1')])
    expect(buffer.take('session-1024')).toEqual([output('session-1024')])
  })

  it('delivers output queued before activation and drops output after retirement', () => {
    const buffer = new TerminalSessionOutputBuffer()

    buffer.add(output('session-1', 'before'))
    buffer.activate('session-1')
    expect(buffer.take('session-1')).toEqual([output('session-1', 'before')])

    buffer.retire('session-1')
    buffer.add(output('session-1', 'late'))
    expect(buffer.take('session-1')).toEqual([])
  })
})

const snapshot: TerminalSessionSnapshot = {
  sessionId: 'session-1',
  status: 'connected',
  error: null,
}

function createOwner() {
  const received: Array<{ data: string; receipt: TerminalOutputReceipt }> = []
  const listener: TerminalSessionListener = {
    onState: () => {},
    onOutput: (data, _bytes, receipt) => received.push({ data, receipt }),
  }
  return { listener, received }
}

describe('TerminalSessionAudience delivery backpressure', () => {
  it('stalls delivery at the chunk ceiling instead of buffering unacknowledged output', () => {
    const onOverflow = vi.fn()
    const audience = new TerminalSessionAudience(vi.fn(), onOverflow)
    const owner = createOwner()
    audience.attach(owner.listener, snapshot)

    for (let index = 0; index < 5000; index += 1) {
      audience.enqueue({ sessionId: 'session-1', data: 'x', bytes: 1 })
    }

    // 16 x MAX_BUFFERED_CHUNKS; the tail waits in the buffer.
    expect(owner.received).toHaveLength(4096)
    expect(onOverflow).toHaveBeenCalledOnce()

    for (const entry of owner.received) entry.receipt.acknowledge()
    audience.enqueue({ sessionId: 'session-1', data: 'y', bytes: 1 })

    expect(owner.received).toHaveLength(5001)
  })

  it('stalls delivery at the byte ceiling instead of buffering unacknowledged output', () => {
    const onOverflow = vi.fn()
    const audience = new TerminalSessionAudience(vi.fn(), onOverflow)
    const owner = createOwner()
    audience.attach(owner.listener, snapshot)
    const chunk = 'x'.repeat(64 * 1024)

    for (let index = 0; index < 200; index += 1) {
      audience.enqueue({
        sessionId: 'session-1',
        data: chunk,
        bytes: chunk.length,
      })
    }

    // 128 x 64 KiB fills the 8 MiB ceiling (16 x MAX_BUFFERED_BYTES).
    expect(owner.received).toHaveLength(128)
    expect(onOverflow).toHaveBeenCalledOnce()
  })
})

describe('TerminalSessionAudience receipt invalidation', () => {
  it('drops an invalidated delivery instead of reclaiming it and returns its credit', () => {
    const acknowledgeBackend = vi.fn()
    const audience = new TerminalSessionAudience(acknowledgeBackend)
    const owner = createOwner()
    const next = createOwner()
    audience.attach(owner.listener, snapshot)
    audience.enqueue({ sessionId: 'session-1', data: 'dropped', bytes: 7 })

    const entry = owner.received.at(0)
    entry?.receipt.invalidate?.()

    expect(entry?.receipt.isActive()).toBe(false)
    expect(acknowledgeBackend).toHaveBeenCalledWith('session-1', 7)

    audience.detach(owner.listener)
    audience.attach(next.listener, snapshot)

    // Before the fix the delivery stayed registered and was reclaimed into the
    // buffer, so the new surface printed output the old one already consumed.
    expect(next.received).toHaveLength(0)
  })
})
