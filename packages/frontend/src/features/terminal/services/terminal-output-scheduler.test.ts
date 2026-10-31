import type { Terminal as XTerminal } from '@baicie/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalOutputScheduler } from './terminal-output-scheduler'
import type { TerminalOutputReceipt } from './terminal-session-manager-types'

type WriteCallback = () => void

function createTerminalStub() {
  const completions: WriteCallback[] = []
  const write = vi.fn((_data: string, callback?: WriteCallback) => {
    if (callback) completions.push(callback)
  })

  return {
    term: { write } as unknown as XTerminal,
    write,
    completeNextWrite() {
      const callback = completions.shift()
      if (!callback) throw new Error('no xterm write is awaiting completion')
      callback()
    },
  }
}

function schedulerOptions(maxBatchBytes = 1024) {
  return {
    maxBatchBytes,
    maxPendingBytes: 4096,
    onOverflow: vi.fn(),
  }
}

function createReceipt(active = true) {
  let isActive = active
  const acknowledge = vi.fn()
  const invalidate = vi.fn(() => {
    isActive = false
  })
  const receipt: TerminalOutputReceipt = {
    isActive: () => isActive,
    acknowledge,
    invalidate,
  }
  return {
    receipt,
    acknowledge,
    invalidate,
    deactivate: () => {
      isActive = false
    },
  }
}

describe('TerminalOutputScheduler', () => {
  let nextFrameId: number
  let frames: Map<number, FrameRequestCallback>
  let cancelAnimationFrameSpy: ReturnType<typeof vi.fn>

  const runAnimationFrame = () => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach(callback => callback(16))
  }

  beforeEach(() => {
    nextFrameId = 1
    frames = new Map()
    cancelAnimationFrameSpy = vi.fn((frameId: number) => {
      frames.delete(frameId)
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const frameId = nextFrameId++
      frames.set(frameId, callback)
      return frameId
    })
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameSpy)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('merges multiple events and writes them on the next animation frame', () => {
    const terminal = createTerminalStub()
    const scheduler = new TerminalOutputScheduler(terminal.term, {
      maxBatchBytes: 1024,
      maxPendingBytes: 4096,
      onOverflow: vi.fn(),
    })

    scheduler.enqueue('hello ')
    scheduler.enqueue('world')
    expect(terminal.write).not.toHaveBeenCalled()

    runAnimationFrame()

    expect(terminal.write).toHaveBeenCalledOnce()
    expect(terminal.write).toHaveBeenCalledWith(
      'hello world',
      expect.any(Function),
    )
  })

  it('exposes byte-level progress while an xterm write is in flight', () => {
    const terminal = createTerminalStub()
    const scheduler = new TerminalOutputScheduler(terminal.term, {
      maxBatchBytes: 1024,
      maxPendingBytes: 4096,
      onOverflow: vi.fn(),
    })

    scheduler.enqueue('hello')
    expect(scheduler.snapshot()).toMatchObject({
      state: 'active',
      acceptedBytes: 5,
      parsedBytes: 0,
      queuedBytes: 5,
      queuedChunks: 1,
      inFlightBytes: 0,
      writeInFlight: false,
    })

    runAnimationFrame()
    expect(scheduler.snapshot()).toMatchObject({
      acceptedBytes: 5,
      parsedBytes: 0,
      queuedBytes: 0,
      queuedChunks: 0,
      inFlightBytes: 5,
      writeInFlight: true,
    })

    terminal.completeNextWrite()
    expect(scheduler.snapshot()).toMatchObject({
      acceptedBytes: 5,
      parsedBytes: 5,
      queuedBytes: 0,
      inFlightBytes: 0,
      writeInFlight: false,
    })
  })

  it('allows one xterm write in flight and resumes on a frame after its callback', () => {
    const terminal = createTerminalStub()
    const scheduler = new TerminalOutputScheduler(terminal.term, {
      maxBatchBytes: 5,
      maxPendingBytes: 4096,
      onOverflow: vi.fn(),
    })

    scheduler.enqueue('first')
    scheduler.enqueue('next')
    runAnimationFrame()

    expect(terminal.write).toHaveBeenCalledTimes(1)
    expect(terminal.write.mock.calls[0]?.[0]).toBe('first')
    runAnimationFrame()
    expect(terminal.write).toHaveBeenCalledTimes(1)

    terminal.completeNextWrite()
    expect(terminal.write).toHaveBeenCalledTimes(1)
    runAnimationFrame()

    expect(terminal.write).toHaveBeenCalledTimes(2)
    expect(terminal.write.mock.calls[1]?.[0]).toBe('next')
  })

  it('falls back when animation frames are throttled and drains without more frames', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const terminal = createTerminalStub()
    const scheduler = new TerminalOutputScheduler(terminal.term, {
      maxBatchBytes: 5,
      maxPendingBytes: 4096,
      onOverflow: vi.fn(),
    })

    scheduler.enqueue('first')
    scheduler.enqueue('next')
    expect(terminal.write).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(terminal.write.mock.calls[0]?.[0]).toBe('first')

    terminal.completeNextWrite()
    await Promise.resolve()
    expect(terminal.write.mock.calls[1]?.[0]).toBe('next')

    terminal.completeNextWrite()
  })

  it('drains a full batch when scheduler frames and timers are suspended', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const terminal = createTerminalStub()
    const scheduler = new TerminalOutputScheduler(terminal.term, {
      maxBatchBytes: 5,
      maxPendingBytes: 4096,
      onOverflow: vi.fn(),
    })

    scheduler.enqueue('first')
    await Promise.resolve()

    expect(terminal.write).toHaveBeenCalledWith('first', expect.any(Function))
    terminal.completeNextWrite()
  })

  it('keeps the xterm write buffer populated during fallback draining', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const terminal = createTerminalStub()
    const scheduler = new TerminalOutputScheduler(
      terminal.term,
      schedulerOptions(5),
    )

    scheduler.enqueue('firstnext')
    await Promise.resolve()
    expect(terminal.write.mock.calls[0]?.[0]).toBe('first')

    terminal.completeNextWrite()

    expect(terminal.write.mock.calls[1]?.[0]).toBe('next')
    terminal.completeNextWrite()
  })

  it('drains a flow-controlled partial batch without scheduler frames or timers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const terminal = createTerminalStub()
    const output = createReceipt()
    const scheduler = new TerminalOutputScheduler(
      terminal.term,
      schedulerOptions(32),
    )

    scheduler.enqueue('partial', 7, output.receipt)
    await Promise.resolve()

    expect(terminal.write).toHaveBeenCalledWith('partial', expect.any(Function))
    expect(output.acknowledge).not.toHaveBeenCalled()
    terminal.completeNextWrite()
    expect(output.acknowledge).toHaveBeenCalledOnce()
  })

  it('drains an uncontrolled tail after fallback output temporarily empties the queue', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const terminal = createTerminalStub()
    const scheduler = new TerminalOutputScheduler(
      terminal.term,
      schedulerOptions(32),
    )

    // The first event enters fallback mode through the flow-control microtask.
    scheduler.enqueue('first', 5)
    await Promise.resolve()
    expect(terminal.write.mock.calls[0]?.[0]).toBe('first')

    terminal.completeNextWrite()

    // This event has no backend byte count, so it must still drain while RAF
    // and the fallback timer remain suspended.
    scheduler.enqueue('tail')
    await Promise.resolve()
    expect(terminal.write.mock.calls[1]?.[0]).toBe('tail')

    terminal.completeNextWrite()
    scheduler.dispose()
  })

  it('preserves ANSI sequences and percent signs byte-for-byte', () => {
    const terminal = createTerminalStub()
    const scheduler = new TerminalOutputScheduler(terminal.term, {
      maxBatchBytes: 1024,
      maxPendingBytes: 4096,
      onOverflow: vi.fn(),
    })
    const output = '\x1b[31mred\x1b[0m\r\n100%\r\n%\r\n'

    scheduler.enqueue(output)
    runAnimationFrame()

    expect(terminal.write.mock.calls[0]?.[0]).toBe(output)
  })

  it('reports a hard-limit overflow once and stops accepting output', () => {
    const terminal = createTerminalStub()
    const onOverflow = vi.fn()
    const scheduler = new TerminalOutputScheduler(terminal.term, {
      maxBatchBytes: 4,
      maxPendingBytes: 4,
      onOverflow,
    })

    scheduler.enqueue('🙂')
    scheduler.enqueue('a')
    scheduler.enqueue('ignored after overflow')
    runAnimationFrame()

    expect(onOverflow).toHaveBeenCalledOnce()
    expect(terminal.write).not.toHaveBeenCalled()
  })

  it('recovers output after an overflow that happened while a write was in flight', () => {
    // The realistic sequence: a build log floods the pane, one batch is already
    // inside xterm, the queue crosses the ceiling and fails, and a later
    // reconnect calls reset(). The stale write must still gate the fresh one:
    // two concurrent xterm.write() calls interleave in its internal buffer and
    // corrupt the stream. The stale callback is what clears writeInFlight, so
    // if the fresh output drained before that callback landed, the pane would
    // show corrupted bytes rather than the recovered session's output.
    const terminal = createTerminalStub()
    const scheduler = new TerminalOutputScheduler(terminal.term, {
      maxBatchBytes: 4,
      maxPendingBytes: 12,
      onOverflow: vi.fn(),
    })

    scheduler.enqueue('aaaa')
    runAnimationFrame()
    expect(terminal.write).toHaveBeenCalledOnce()
    expect(scheduler.snapshot().writeInFlight).toBe(true)

    // Fill the headroom the in-flight batch leaves, then cross the ceiling.
    scheduler.enqueue('bbbb')
    scheduler.enqueue('cccc')
    scheduler.enqueue('dddd')
    expect(scheduler.snapshot().state).toBe('failed')

    scheduler.reset()
    scheduler.enqueue('fresh')
    runAnimationFrame()

    // The fresh output must wait for the stale write to finish.
    expect(terminal.write).toHaveBeenCalledOnce()
    expect(scheduler.snapshot().writeInFlight).toBe(true)

    terminal.completeNextWrite()
    for (let round = 0; round < 4; round += 1) {
      runAnimationFrame()
      if (scheduler.snapshot().writeInFlight) {
        terminal.completeNextWrite()
      }
    }

    expect(terminal.write.mock.calls.map(call => call[0]).join('')).toBe(
      'aaaafresh',
    )
    expect(scheduler.snapshot().state).toBe('active')
  })

  it('cancels a pending frame and ignores later output when disposed', () => {
    const terminal = createTerminalStub()
    const scheduler = new TerminalOutputScheduler(terminal.term, {
      maxBatchBytes: 1024,
      maxPendingBytes: 4096,
      onOverflow: vi.fn(),
    })

    scheduler.enqueue('pending')
    scheduler.dispose()
    scheduler.enqueue('after dispose')
    runAnimationFrame()

    expect(cancelAnimationFrameSpy).toHaveBeenCalledOnce()
    expect(terminal.write).not.toHaveBeenCalled()
  })

  it('does not acknowledge queued output that never reached xterm', () => {
    const terminal = createTerminalStub()
    const output = createReceipt()
    const scheduler = new TerminalOutputScheduler(
      terminal.term,
      schedulerOptions(),
    )

    scheduler.enqueue('queued', 6, output.receipt)
    scheduler.dispose()

    expect(output.acknowledge).not.toHaveBeenCalled()
  })

  it('waits for a stale in-flight write before draining reset output', () => {
    const terminal = createTerminalStub()
    const scheduler = new TerminalOutputScheduler(terminal.term, {
      maxBatchBytes: 5,
      maxPendingBytes: 10,
      onOverflow: vi.fn(),
    })

    scheduler.enqueue('first')
    runAnimationFrame()
    scheduler.enqueue('overflow')
    scheduler.reset()
    scheduler.enqueue('fresh')
    runAnimationFrame()
    expect(terminal.write).toHaveBeenCalledOnce()

    terminal.completeNextWrite()
    runAnimationFrame()
    expect(terminal.write).toHaveBeenCalledTimes(2)
    expect(terminal.write.mock.calls[1]?.[0]).toBe('fresh')
  })

  it('splits one oversized event at UTF-8 boundaries before acknowledging it', () => {
    const terminal = createTerminalStub()
    const output = createReceipt()
    const scheduler = new TerminalOutputScheduler(
      terminal.term,
      schedulerOptions(4),
    )

    scheduler.enqueue('A中🙂B', 9, output.receipt)
    runAnimationFrame()
    expect(terminal.write.mock.calls[0]?.[0]).toBe('A中')

    terminal.completeNextWrite()
    expect(output.acknowledge).not.toHaveBeenCalled()
    runAnimationFrame()
    expect(terminal.write.mock.calls[1]?.[0]).toBe('🙂')

    terminal.completeNextWrite()
    expect(output.acknowledge).not.toHaveBeenCalled()
    runAnimationFrame()
    expect(terminal.write.mock.calls[2]?.[0]).toBe('B')

    terminal.completeNextWrite()
    expect(output.acknowledge).toHaveBeenCalledOnce()
  })

  it('writes one code point intact when it exceeds the configured budget', () => {
    const terminal = createTerminalStub()
    const output = createReceipt()
    const scheduler = new TerminalOutputScheduler(
      terminal.term,
      schedulerOptions(1),
    )

    scheduler.enqueue('🙂', 4, output.receipt)
    runAnimationFrame()

    expect(terminal.write.mock.calls[0]?.[0]).toBe('🙂')
    terminal.completeNextWrite()
    expect(output.acknowledge).toHaveBeenCalledOnce()
  })

  it('acknowledges merged UTF-8 bytes only after xterm completes the write', () => {
    const terminal = createTerminalStub()
    const output = createReceipt()
    const scheduler = new TerminalOutputScheduler(
      terminal.term,
      schedulerOptions(),
    )

    scheduler.enqueue('A中🙂', 8, output.receipt)
    runAnimationFrame()

    expect(terminal.write.mock.calls[0]?.[0]).toBe('A中🙂')
    expect(output.acknowledge).not.toHaveBeenCalled()

    terminal.completeNextWrite()

    expect(output.acknowledge).toHaveBeenCalledOnce()
  })

  it('acknowledges each completed batch with its exact UTF-8 byte count', () => {
    const terminal = createTerminalStub()
    const first = createReceipt()
    const second = createReceipt()
    const third = createReceipt()
    const scheduler = new TerminalOutputScheduler(
      terminal.term,
      schedulerOptions(4),
    )

    scheduler.enqueue('中', 3, first.receipt)
    scheduler.enqueue('a', 1, second.receipt)
    scheduler.enqueue('🙂', 4, third.receipt)
    runAnimationFrame()
    expect(terminal.write.mock.calls[0]?.[0]).toBe('中a')
    expect(first.acknowledge).not.toHaveBeenCalled()
    expect(second.acknowledge).not.toHaveBeenCalled()

    terminal.completeNextWrite()
    expect(first.acknowledge).toHaveBeenCalledOnce()
    expect(second.acknowledge).toHaveBeenCalledOnce()
    expect(third.acknowledge).not.toHaveBeenCalled()

    runAnimationFrame()
    expect(terminal.write.mock.calls[1]?.[0]).toBe('🙂')
    expect(third.acknowledge).not.toHaveBeenCalled()

    terminal.completeNextWrite()
    expect(third.acknowledge).toHaveBeenCalledOnce()
  })

  it('does not acknowledge a stale write against the reset generation', () => {
    const terminal = createTerminalStub()
    const stale = createReceipt()
    const fresh = createReceipt()
    const scheduler = new TerminalOutputScheduler(
      terminal.term,
      schedulerOptions(16),
    )

    scheduler.enqueue('stale', 5, stale.receipt)
    runAnimationFrame()
    scheduler.reset()
    scheduler.enqueue('新', 3, fresh.receipt)

    terminal.completeNextWrite()
    expect(stale.acknowledge).not.toHaveBeenCalled()

    runAnimationFrame()
    expect(terminal.write.mock.calls[1]?.[0]).toBe('新')
    terminal.completeNextWrite()
    expect(fresh.acknowledge).toHaveBeenCalledOnce()
  })

  it('does not acknowledge an in-flight write after disposal', () => {
    const terminal = createTerminalStub()
    const completed = createReceipt()
    const stale = createReceipt()
    const scheduler = new TerminalOutputScheduler(
      terminal.term,
      schedulerOptions(16),
    )

    scheduler.enqueue('completed', 9, completed.receipt)
    runAnimationFrame()
    terminal.completeNextWrite()
    expect(completed.acknowledge).toHaveBeenCalledOnce()

    scheduler.enqueue('stale', 5, stale.receipt)
    runAnimationFrame()
    scheduler.dispose()
    terminal.completeNextWrite()

    expect(stale.acknowledge).not.toHaveBeenCalled()
  })

  it('rejects a backend byte count that does not match the UTF-8 payload', () => {
    const terminal = createTerminalStub()
    const output = createReceipt()
    const onOverflow = vi.fn()
    const scheduler = new TerminalOutputScheduler(terminal.term, {
      maxBatchBytes: 16,
      maxPendingBytes: 64,
      onOverflow,
    })

    expect(scheduler.enqueue('中', 1, output.receipt)).toBe(false)
    runAnimationFrame()

    expect(onOverflow).toHaveBeenCalledOnce()
    expect(terminal.write).not.toHaveBeenCalled()
    expect(output.acknowledge).not.toHaveBeenCalled()
  })

  it('skips queued output after its surface ownership is revoked', () => {
    const terminal = createTerminalStub()
    const output = createReceipt()
    const scheduler = new TerminalOutputScheduler(
      terminal.term,
      schedulerOptions(),
    )

    scheduler.enqueue('stale', 5, output.receipt)
    output.deactivate()
    runAnimationFrame()

    expect(terminal.write).not.toHaveBeenCalled()
    expect(output.acknowledge).not.toHaveBeenCalled()
  })

  it('does not acknowledge an in-flight batch after ownership is revoked', () => {
    const terminal = createTerminalStub()
    const output = createReceipt()
    const scheduler = new TerminalOutputScheduler(
      terminal.term,
      schedulerOptions(),
    )

    scheduler.enqueue('stale', 5, output.receipt)
    runAnimationFrame()
    output.deactivate()
    terminal.completeNextWrite()

    expect(output.acknowledge).not.toHaveBeenCalled()
  })

  it('voids the receipt of output it refuses to queue', () => {
    const terminal = createTerminalStub()
    const scheduler = new TerminalOutputScheduler(
      terminal.term,
      schedulerOptions(),
    )
    const queued = createReceipt()

    scheduler.enqueue('kept', 4, queued.receipt)
    scheduler.reset()

    expect(queued.invalidate).toHaveBeenCalledOnce()
    expect(queued.acknowledge).not.toHaveBeenCalled()

    const rejected = createReceipt()
    scheduler.dispose()

    expect(scheduler.enqueue('late', 4, rejected.receipt)).toBe(false)
    expect(rejected.invalidate).toHaveBeenCalledOnce()
    expect(rejected.acknowledge).not.toHaveBeenCalled()
  })

  it('leaves queued receipts reclaimable when a surface is disposed', () => {
    const terminal = createTerminalStub()
    const scheduler = new TerminalOutputScheduler(
      terminal.term,
      schedulerOptions(),
    )
    const reclaimable = createReceipt()

    scheduler.enqueue('kept', 4, reclaimable.receipt)
    scheduler.dispose()

    // A disposed surface must not void its delivery: the audience reclaims it so
    // the next surface prints output this one never wrote.
    expect(reclaimable.invalidate).not.toHaveBeenCalled()
    expect(reclaimable.receipt.isActive()).toBe(true)
  })

  it('voids and reports every queued receipt it drops on overflow', () => {
    const terminal = createTerminalStub()
    const onOverflow = vi.fn()
    const scheduler = new TerminalOutputScheduler(terminal.term, {
      maxBatchBytes: 4,
      maxPendingBytes: 8,
      onOverflow,
    })
    const queued = createReceipt()
    const rejected = createReceipt()

    scheduler.enqueue('aaaa', 4, queued.receipt)
    expect(scheduler.enqueue('bbbbb', 5, rejected.receipt)).toBe(false)

    expect(onOverflow).toHaveBeenCalledOnce()
    expect(queued.invalidate).toHaveBeenCalledOnce()
    expect(queued.acknowledge).not.toHaveBeenCalled()
    expect(rejected.invalidate).toHaveBeenCalledOnce()
    expect(terminal.write).not.toHaveBeenCalled()
  })

  // P8.4: a silent drop is a lost byte. These tests pin the accounting that
  // turns every discarded chunk into a counted, reported drop.
  describe('dropped output accounting', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('counts bytes dropped when a queued receipt is invalidated instead of losing them silently', () => {
      const terminal = createTerminalStub()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const scheduler = new TerminalOutputScheduler(
        terminal.term,
        schedulerOptions(),
      )
      const output = createReceipt()
      const data = 'stale-output-that-will-never-be-rendered-0123456789'

      scheduler.enqueue(data, data.length, output.receipt)
      output.deactivate()
      runAnimationFrame()

      expect(terminal.write).not.toHaveBeenCalled()
      expect(scheduler.snapshot()).toMatchObject({
        acceptedBytes: data.length,
        parsedBytes: 0,
        droppedBytes: data.length,
        droppedChunks: 1,
        queuedBytes: 0,
        queuedChunks: 0,
      })
      expect(warn).toHaveBeenCalledOnce()
      const report = String(warn.mock.calls[0]?.[0])
      expect(report).toContain(`dropped ${data.length} bytes`)
      expect(report).toContain('inactive-receipt')
      expect(report).toContain(data.slice(0, 32))
      expect(report).not.toContain(data.slice(0, 33))
    })

    it('reports dropped pending bytes when reset discards the queue', () => {
      const terminal = createTerminalStub()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const scheduler = new TerminalOutputScheduler(
        terminal.term,
        schedulerOptions(),
      )
      const output = createReceipt()

      scheduler.enqueue('queued-once', 11, output.receipt)
      scheduler.reset()

      expect(scheduler.snapshot()).toMatchObject({
        acceptedBytes: 11,
        parsedBytes: 0,
        droppedBytes: 11,
        droppedChunks: 1,
        queuedBytes: 0,
        queuedChunks: 0,
      })
      expect(warn).toHaveBeenCalledOnce()
      expect(String(warn.mock.calls[0]?.[0])).toContain('(reset)')
    })

    it('keeps acceptedBytes equal to parsedBytes plus reported droppedBytes', () => {
      const terminal = createTerminalStub()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const scheduler = new TerminalOutputScheduler(
        terminal.term,
        schedulerOptions(),
      )
      const rendered = createReceipt()
      const dropped = createReceipt()

      scheduler.enqueue('rendered', 8, rendered.receipt)
      runAnimationFrame()
      terminal.completeNextWrite()
      expect(rendered.acknowledge).toHaveBeenCalledOnce()

      scheduler.enqueue('dropped', 7, dropped.receipt)
      dropped.deactivate()
      runAnimationFrame()

      const snapshot = scheduler.snapshot()
      expect(snapshot.droppedBytes).toBe(7)
      expect(snapshot.droppedChunks).toBe(1)
      expect(snapshot.acceptedBytes).toBe(15)
      expect(snapshot.queuedBytes).toBe(0)
      expect(snapshot.inFlightBytes).toBe(0)
      expect(snapshot.acceptedBytes).toBe(
        snapshot.parsedBytes + snapshot.droppedBytes,
      )
    })

    it('keeps an abandoned in-flight write accounted after reset', () => {
      // reset() drops the queue, never the xterm write already in flight: the
      // stale callback still counts those bytes as parsed, and clearing
      // writeInFlight would let the next write overlap it inside xterm.
      const terminal = createTerminalStub()
      const scheduler = new TerminalOutputScheduler(
        terminal.term,
        schedulerOptions(4),
      )

      scheduler.enqueue('aaaa')
      runAnimationFrame()
      scheduler.reset()

      expect(scheduler.snapshot()).toMatchObject({
        acceptedBytes: 4,
        parsedBytes: 0,
        droppedBytes: 0,
        inFlightBytes: 4,
        writeInFlight: true,
      })

      terminal.completeNextWrite()
      const snapshot = scheduler.snapshot()
      expect(snapshot).toMatchObject({
        parsedBytes: 4,
        inFlightBytes: 0,
        writeInFlight: false,
      })
      expect(snapshot.acceptedBytes).toBe(
        snapshot.parsedBytes + snapshot.droppedBytes,
      )
    })
  })
})
