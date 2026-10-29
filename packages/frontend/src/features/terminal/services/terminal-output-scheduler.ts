import type { Terminal as XTerminal } from '@baicie/xterm'
import {
  splitTerminalOutput,
  terminalOutputByteLength,
  type PendingTerminalOutput,
} from './terminal-output-chunks'
import type { TerminalOutputReceipt } from './terminal-session-manager-types'

const DEFAULT_MAX_BATCH_BYTES = 32 * 1024
const DEFAULT_MAX_PENDING_BYTES = 16 * 1024 * 1024
const DEFAULT_FRAME_FALLBACK_MS = 100

interface OutputBatch {
  data: string
  bytes: number
  receipts: TerminalOutputReceipt[]
}

export interface TerminalOutputSchedulerSnapshot {
  state: 'active' | 'failed' | 'disposed'
  acceptedBytes: number
  parsedBytes: number
  queuedBytes: number
  queuedChunks: number
  inFlightBytes: number
  writeInFlight: boolean
}

interface TerminalOutputSchedulerOptions {
  maxBatchBytes?: number
  maxPendingBytes?: number
  onOverflow: (error: Error) => void
}

export class TerminalOutputScheduler {
  private readonly queue: PendingTerminalOutput[] = []
  private readonly maxBatchBytes: number
  private readonly maxPendingBytes: number
  private queuedBytes = 0
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
    if (!data || this.state !== 'active') return false
    const bytes = terminalOutputByteLength(data)
    if (backendBytes !== undefined && backendBytes !== bytes) {
      this.fail(
        new Error('Terminal output byte count does not match its UTF-8 data'),
      )
      return false
    }
    if (this.queuedBytes + this.inFlightBytes + bytes > this.maxPendingBytes) {
      this.fail(
        new Error(
          `Terminal output queue exceeded ${this.maxPendingBytes} bytes`,
        ),
      )
      return false
    }
    this.queue.push({ data, bytes, receipt, completesReceipt: true })
    this.queuedBytes += bytes
    this.acceptedBytes += bytes
    this.schedule(backendBytes !== undefined)
    return true
  }

  snapshot(): TerminalOutputSchedulerSnapshot {
    return {
      state: this.state,
      acceptedBytes: this.acceptedBytes,
      parsedBytes: this.parsedBytes,
      queuedBytes: this.queuedBytes,
      queuedChunks: this.queue.length,
      inFlightBytes: this.inFlightBytes,
      writeInFlight: this.writeInFlight,
    }
  }

  reset(): void {
    if (this.state === 'disposed') return
    this.generation++
    this.state = 'active'
    this.clearPending()
  }

  dispose(): void {
    if (this.state === 'disposed') return
    this.generation++
    this.state = 'disposed'
    this.clearPending()
  }

  private schedule(flowControlled = false): void {
    if (this.queue.length === 0) {
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
    if (flowControlled || this.queuedBytes >= this.maxBatchBytes) {
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
    const batch = this.takeBatch()
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

  private takeBatch(): OutputBatch | null {
    const first = this.takeHead(this.maxBatchBytes, true)
    if (!first) return null
    let data = first.data
    let bytes = first.bytes
    const receipts =
      first.receipt && first.completesReceipt ? [first.receipt] : []
    while (this.queue.length > 0) {
      const remaining = this.maxBatchBytes - bytes
      if (remaining <= 0) break
      const next = this.takeHead(remaining, false)
      if (!next) break
      data += next.data
      bytes += next.bytes
      if (next.receipt && next.completesReceipt) receipts.push(next.receipt)
    }
    return { data, bytes, receipts }
  }

  private takeHead(
    maxBytes: number,
    allowOversizedCodePoint: boolean,
  ): PendingTerminalOutput | null {
    let output = this.queue[0]
    while (output?.receipt && !output.receipt.isActive()) {
      this.queue.shift()
      this.queuedBytes -= output.bytes
      output = this.queue[0]
    }
    if (!output) return null
    const [head, tail] = splitTerminalOutput(output, maxBytes)
    if (head.bytes > maxBytes && !allowOversizedCodePoint) return null

    if (tail) {
      this.queue[0] = tail
    } else {
      this.queue.shift()
    }
    this.queuedBytes -= head.bytes
    return head
  }

  private fail(error: Error): void {
    if (this.state !== 'active') return
    this.generation++
    this.state = 'failed'
    this.clearPending()
    this.options.onOverflow(error)
  }

  private clearPending(): void {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId)
    this.frameId = null
    this.clearFrameFallback()
    this.clearScheduledMicrotask()
    this.fallbackDrain = false
    this.queue.length = 0
    this.queuedBytes = 0
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
