import {
  splitTerminalOutput,
  type PendingTerminalOutput,
} from './terminal-output-chunks'
import type { TerminalOutputReceipt } from './terminal-session-manager-types'

const DROP_PREFIX_LENGTH = 32

export type TerminalOutputDropReason =
  | 'inactive-receipt'
  | 'reset'
  | 'dispose'
  | 'fail'

interface OutputBatch {
  data: string
  bytes: number
  receipts: TerminalOutputReceipt[]
}

/**
 * P8.4: output the consumer accepted but will never render must not disappear
 * silently. Every dropped byte is counted here, reported once, and exposed
 * through the scheduler snapshot so acceptedBytes = parsedBytes + droppedBytes
 * stays checkable. The scheduler has no session identity of its own, so the
 * report carries the reason, the byte count, and a 32-character data prefix.
 */
export class TerminalOutputDropLedger {
  private byteCount = 0
  private chunkCount = 0
  private reported = false

  get droppedBytes(): number {
    return this.byteCount
  }

  get droppedChunks(): number {
    return this.chunkCount
  }

  record(
    reason: TerminalOutputDropReason,
    bytes: number,
    chunks: number,
    data: string,
  ): void {
    if (bytes <= 0) return
    this.byteCount += bytes
    this.chunkCount += Math.max(1, chunks)
    if (this.reported) return
    this.reported = true
    console.warn(
      `[terminal-output] dropped ${bytes} bytes (${reason}): ${data.slice(0, DROP_PREFIX_LENGTH)}`,
    )
  }
}

/** The queue behind a scheduler: pending chunks, their byte total, and drops. */
export class TerminalOutputQueue {
  private readonly queue: PendingTerminalOutput[] = []
  private queued = 0

  constructor(private readonly ledger: TerminalOutputDropLedger) {}

  get queuedBytes(): number {
    return this.queued
  }

  get queuedChunks(): number {
    return this.queue.length
  }

  push(output: PendingTerminalOutput): void {
    this.queue.push(output)
    this.queued += output.bytes
  }

  invalidateReceipts(): void {
    for (const output of this.queue) output.receipt?.invalidate?.()
  }

  clear(reason: TerminalOutputDropReason): void {
    this.ledger.record(
      reason,
      this.queued,
      this.queue.length,
      this.queue[0]?.data ?? '',
    )
    this.queue.length = 0
    this.queued = 0
  }

  takeBatch(maxBytes: number): OutputBatch | null {
    const first = this.takeHead(maxBytes, true)
    if (!first) return null
    let data = first.data
    let bytes = first.bytes
    const receipts =
      first.receipt && first.completesReceipt ? [first.receipt] : []
    while (this.queue.length > 0) {
      const remaining = maxBytes - bytes
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
      this.queued -= output.bytes
      this.ledger.record('inactive-receipt', output.bytes, 1, output.data)
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
    this.queued -= head.bytes
    return head
  }
}
