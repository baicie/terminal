import type { Terminal as XTerminal } from '@baicie/xterm'
import { terminalOutputByteLength } from './terminal-output-chunks'
import {
  TerminalOutputDropLedger,
  TerminalOutputQueue,
  type TerminalOutputDropReason,
} from './terminal-output-queue'
import type { TerminalOutputReceipt } from './terminal-session-manager-types'

const DEFAULT_MAX_BATCH_BYTES = 32 * 1024
const DEFAULT_MAX_PENDING_BYTES = 16 * 1024 * 1024
const DEFAULT_FRAME_FALLBACK_MS = 100

export interface TerminalOutputSchedulerSnapshot {
  state: 'active' | 'failed' | 'disposed'
  acceptedBytes: number
  parsedBytes: number
  droppedBytes: number
  queuedBytes: number
  queuedChunks: number
  droppedChunks: number
  inFlightBytes: number
  writeInFlight: boolean
}

interface TerminalOutputSchedulerOptions {
  maxBatchBytes?: number
  maxPendingBytes?: number
  onOverflow: (error: Error) => void
}

export class TerminalOutputScheduler {
  private readonly drops = new TerminalOutputDropLedger()
  private readonly pending = new TerminalOutputQueue(this.drops)
  private readonly maxBatchBytes: number
  private readonly maxPendingBytes: number
  private inFlightBytes = 0
  private acceptedBytes = 0
  private parsedBytes = 0
  private frameId: number | null = null
  private frameFallbackTimer: ReturnType<typeof setTimeout> | null = null
  private microtaskPending = false
  private microtaskId = 0
  private fallbackDrain = false
  private writeInFlight = false
  private generation = 0
  private state: 'active' | 'failed' | 'disposed' = 'active'

  constructor(
    private readonly terminal: Pick<XTerminal, 'write'>,
    private readonly options: TerminalOutputSchedulerOptions,
  ) {
    this.maxBatchBytes = Math.max(
      1,
      options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES,
    )
    this.maxPendingBytes = Math.max(
      1,
      options.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES,
    )
  }

  enqueue(
    data: string,
    backendBytes?: number,
    receipt?: TerminalOutputReceipt,
  ): boolean {
    if (!data || this.state !== 'active') {
      // Never rendered: void it so reclaim cannot deliver it a second time.
      receipt?.invalidate?.()
      return false
    }
    const bytes = terminalOutputByteLength(data)
    if (backendBytes !== undefined && backendBytes !== bytes) {
      this.fail(
        new Error('Terminal output byte count does not match its UTF-8 data'),
      )
      receipt?.invalidate?.()
      return false
    }
    if (
      this.pending.queuedBytes + this.inFlightBytes + bytes >
      this.maxPendingBytes
    ) {
      this.fail(
        new Error(
          `Terminal output queue exceeded ${this.maxPendingBytes} bytes`,
        ),
      )
      receipt?.invalidate?.()
      return false
    }
    this.pending.push({ data, bytes, receipt, completesReceipt: true })
    this.acceptedBytes += bytes
    this.schedule(backendBytes !== undefined)
    return true
  }

  snapshot(): TerminalOutputSchedulerSnapshot {
    return {
      state: this.state,
      acceptedBytes: this.acceptedBytes,
      parsedBytes: this.parsedBytes,
      droppedBytes: this.drops.droppedBytes,
      queuedBytes: this.pending.queuedBytes,
      queuedChunks: this.pending.queuedChunks,
      droppedChunks: this.drops.droppedChunks,
      inFlightBytes: this.inFlightBytes,
      writeInFlight: this.writeInFlight,
    }
  }

  reset(): void {
    if (this.state === 'disposed') return
    this.generation++
    this.state = 'active'
    this.pending.invalidateReceipts()
    this.clearPending('reset')
    // reset() abandons the queue only. The in-flight batch stays accounted as
    // in flight on purpose: clearing writeInFlight would let the next write
    // overlap the stale one inside xterm's own buffer, and the stale callback
    // still adds those bytes to parsedBytes, so acceptedBytes stays explained.
  }

  dispose(): void {
    if (this.state === 'disposed') return
    this.generation++
    this.state = 'disposed'
    this.clearPending('dispose')
  }

  private schedule(flowControlled = false): void {
    if (this.pending.queuedChunks === 0) {
      this.fallbackDrain = false
      return
    }
    if (
      this.frameId !== null ||
      this.frameFallbackTimer !== null ||
      this.microtaskPending ||
      this.writeInFlight ||
      this.state !== 'active'
    ) {
      return
    }

    const generation = this.generation
    if (this.fallbackDrain) {
      this.scheduleMicrotask(generation, false)
      return
    }

    this.frameId = requestAnimationFrame(() => {
      if (generation !== this.generation) return
      this.clearScheduledMicrotask()
      this.frameId = null
      this.clearFrameFallback()
      this.flushFrame()
    })
    this.frameFallbackTimer = setTimeout(() => {
      if (generation !== this.generation) return
      this.frameFallbackTimer = null
      this.clearScheduledMicrotask()
      if (this.frameId !== null) cancelAnimationFrame(this.frameId)
      this.frameId = null
      this.fallbackDrain = true
      this.flushFrame()
    }, DEFAULT_FRAME_FALLBACK_MS)
    if (flowControlled || this.pending.queuedBytes >= this.maxBatchBytes) {
      this.scheduleMicrotask(generation, true)
    }
  }

  private scheduleMicrotask(generation: number, cancelFrame: boolean): void {
    const microtaskId = ++this.microtaskId
    this.microtaskPending = true
    queueMicrotask(() => {
      if (generation !== this.generation || microtaskId !== this.microtaskId) {
        return
      }
      this.microtaskPending = false
      if (cancelFrame) {
        if (this.frameId !== null) cancelAnimationFrame(this.frameId)
        this.frameId = null
        this.clearFrameFallback()
        this.fallbackDrain = true
      }
      this.flushFrame()
    })
  }

  private flushFrame(): void {
    this.frameId = null
    if (this.writeInFlight || this.state !== 'active') return
    const batch = this.pending.takeBatch(this.maxBatchBytes)
    if (!batch) {
      // Keep fallback mode across an empty queue. WKWebView can pause RAF and
      // timers between two backend events; clearing this flag here would make
      // the next small, uncontrolled event wait indefinitely for one of them.
      return
    }

    const generation = this.generation
    this.writeInFlight = true
    this.inFlightBytes = batch.bytes
    try {
      this.terminal.write(batch.data, () => {
        this.writeInFlight = false
        this.inFlightBytes = 0
        this.parsedBytes += batch.bytes
        if (generation !== this.generation || this.state !== 'active') {
          this.schedule()
          return
        }
        for (const receipt of batch.receipts) {
          if (receipt.isActive()) receipt.acknowledge()
        }
        if (this.fallbackDrain) {
          // Keep xterm's internal WriteBuffer populated so a throttled timer is
          // not required to start every subsequent batch.
          this.flushFrame()
        } else {
          this.schedule()
        }
      })
    } catch {
      this.writeInFlight = false
      this.inFlightBytes = 0
      this.fail(new Error('xterm rejected terminal output'))
    }
  }

  private fail(error: Error): void {
    if (this.state !== 'active') return
    this.generation++
    this.state = 'failed'
    this.pending.invalidateReceipts()
    this.clearPending('fail')
    this.options.onOverflow(error)
  }

  private clearPending(reason: TerminalOutputDropReason): void {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId)
    this.frameId = null
    this.clearFrameFallback()
    this.clearScheduledMicrotask()
    this.fallbackDrain = false
    this.pending.clear(reason)
  }

  private clearFrameFallback(): void {
    if (this.frameFallbackTimer !== null) {
      clearTimeout(this.frameFallbackTimer)
      this.frameFallbackTimer = null
    }
  }

  private clearScheduledMicrotask(): void {
    this.microtaskPending = false
    this.microtaskId++
  }
}
