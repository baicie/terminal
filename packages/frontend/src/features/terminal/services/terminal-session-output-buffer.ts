import type { ShellOutput } from '../types'
import type {
  BufferedTerminalOutput,
  TerminalOutputReceipt,
  TerminalSessionListener,
  TerminalSessionSnapshot,
} from './terminal-session-manager-types'

const MAX_BUFFERED_CHUNKS = 256
const MAX_BUFFERED_BYTES = 512 * 1024
const MAX_PENDING_SESSIONS = 1024
// A re-attaching surface replays its whole backlog in one burst, so the delivery
// ceiling sits an order of magnitude above the buffer ceiling: far above any
// legitimate burst, still bounded once an owner stops acknowledging.
const MAX_DELIVERED_CHUNKS = 16 * MAX_BUFFERED_CHUNKS
const MAX_DELIVERED_BYTES = 16 * MAX_BUFFERED_BYTES

function hasBackendFlowControl(output: BufferedTerminalOutput): boolean {
  return (
    Number.isSafeInteger(output.bytes) &&
    output.bytes !== undefined &&
    output.bytes > 0
  )
}

function trimUncontrolledOutput(items: BufferedTerminalOutput[]): void {
  let chunks = 0
  let bytes = 0
  for (const item of items) {
    if (hasBackendFlowControl(item)) continue
    chunks++
    bytes += item.data.length
  }
  while (chunks > MAX_BUFFERED_CHUNKS || bytes > MAX_BUFFERED_BYTES) {
    const index = items.findIndex(item => !hasBackendFlowControl(item))
    if (index < 0) return
    const [removed] = items.splice(index, 1)
    chunks--
    bytes -= removed.data.length
  }
}

function trimPendingSessions(pending: Map<string, ShellOutput[]>): void {
  while (pending.size > MAX_PENDING_SESSIONS) {
    const evictable = [...pending].find(([, items]) =>
      items.every(item => !hasBackendFlowControl(item)),
    )
    if (!evictable) return
    pending.delete(evictable[0])
  }
}

interface DeliveredTerminalOutput {
  listener: TerminalSessionListener
  output: BufferedTerminalOutput
}

type BackendAcknowledger = (sessionId: string, bytes: number) => void
type OutputOverflowReporter = (error: Error) => void

/**
 * Deliver a snapshot without letting one broken listener escape. Session state
 * is published from inside the reconnect retry loop, so an exception here
 * would reject the retry promise and abandon the whole attempt budget, leaving
 * the pane stuck in `reconnecting` forever. Other panes must still see the
 * state, so the failure is contained per listener.
 */
function notifyState(
  listener: TerminalSessionListener,
  snapshot: TerminalSessionSnapshot,
): void {
  try {
    listener.onState(snapshot)
  } catch (error) {
    console.error('[terminal] terminal state listener failed:', error)
  }
}

function normalizeOutput(
  output: ShellOutput | BufferedTerminalOutput,
): BufferedTerminalOutput {
  if ('session_id' in output) {
    return {
      sessionId: output.session_id,
      data: output.data,
      bytes: output.bytes,
    }
  }
  return output
}

/** Owns the single xterm consumer and keeps output until that surface renders it. */
export class TerminalSessionAudience {
  private readonly listeners = new Set<TerminalSessionListener>()
  private buffered: BufferedTerminalOutput[] = []
  private readonly delivered = new Map<number, DeliveredTerminalOutput>()
  private owner: TerminalSessionListener | null = null
  private nextDeliveryId = 1
  private deliveredBytes = 0
  private overflowReported = false

  constructor(
    private readonly acknowledgeBackend: BackendAcknowledger,
    private readonly onOverflow: OutputOverflowReporter = error =>
      console.error('[terminal] terminal output delivery overflow:', error),
  ) {}

  attach(
    listener: TerminalSessionListener,
    snapshot: TerminalSessionSnapshot,
  ): void {
    this.listeners.add(listener)
    notifyState(listener, snapshot)
    if (this.owner !== listener) {
      if (this.owner) this.reclaim(this.owner)
      this.owner = listener
    }
    this.drain()
  }

  detach(listener: TerminalSessionListener): void {
    this.listeners.delete(listener)
    if (this.owner !== listener) return
    this.reclaim(listener)
    this.owner = Array.from(this.listeners).at(-1) ?? null
    this.drain()
  }

  publishState(snapshot: TerminalSessionSnapshot): void {
    for (const listener of this.listeners) notifyState(listener, snapshot)
  }

  enqueue(output: ShellOutput | BufferedTerminalOutput): void {
    this.buffered.push(normalizeOutput(output))
    trimUncontrolledOutput(this.buffered)
    this.drain()
  }

  retire(sessionId: string): void {
    this.buffered = this.buffered.filter(item => item.sessionId !== sessionId)
    for (const [deliveryId, delivery] of this.delivered) {
      if (delivery.output.sessionId === sessionId) {
        this.dropDelivery(deliveryId)
      }
    }
  }

  retireAll(): void {
    this.buffered.length = 0
    this.delivered.clear()
    this.deliveredBytes = 0
    this.overflowReported = false
  }

  clear(): void {
    this.listeners.clear()
    this.owner = null
    this.buffered.length = 0
    this.delivered.clear()
    this.deliveredBytes = 0
    this.overflowReported = false
  }

  private drain(): void {
    const listener = this.owner
    if (!listener) return
    while (this.owner === listener && this.buffered.length > 0) {
      const output = this.buffered[0]
      if (!output) return
      // Backpressure: an owner that stops acknowledging must stall delivery
      // instead of growing the delivery table without bound.
      if (!this.canDeliver(output)) {
        this.reportOverflow()
        return
      }
      this.buffered.shift()
      const deliveryId = this.nextDeliveryId++
      this.delivered.set(deliveryId, { listener, output })
      this.deliveredBytes += output.data.length
      const receipt: TerminalOutputReceipt = {
        isActive: () => this.delivered.get(deliveryId)?.listener === listener,
        acknowledge: () => this.acknowledge(deliveryId, listener),
        invalidate: () => this.invalidateDelivery(deliveryId),
      }
      try {
        listener.onOutput(output.data, output.bytes, receipt)
      } catch (error) {
        // A throwing render surface must not abort the drain loop: every later
        // chunk would stop reaching the pane as well. The delivery stays
        // registered so detaching the surface re-delivers it like any other
        // unacknowledged chunk instead of dropping it silently.
        console.error('[terminal] output listener failed:', error)
      }
    }
  }

  private acknowledge(
    deliveryId: number,
    listener: TerminalSessionListener,
  ): void {
    const delivery = this.delivered.get(deliveryId)
    if (!delivery || delivery.listener !== listener) return
    this.dropDelivery(deliveryId)
    this.acknowledgeOutput(delivery.output)
  }

  private invalidateDelivery(deliveryId: number): void {
    const delivery = this.dropDelivery(deliveryId)
    if (delivery) this.acknowledgeOutput(delivery.output)
  }

  private acknowledgeOutput(output: BufferedTerminalOutput): void {
    const { sessionId, bytes } = output
    if (
      sessionId &&
      Number.isSafeInteger(bytes) &&
      bytes !== undefined &&
      bytes > 0
    ) {
      this.acknowledgeBackend(sessionId, bytes)
    }
  }

  private canDeliver(output: BufferedTerminalOutput): boolean {
    if (this.delivered.size === 0) return true
    if (this.delivered.size >= MAX_DELIVERED_CHUNKS) return false
    return this.deliveredBytes + output.data.length <= MAX_DELIVERED_BYTES
  }

  private reportOverflow(): void {
    if (this.overflowReported) return
    this.overflowReported = true
    this.onOverflow(
      new Error(
        `Terminal output delivery stalled: ${MAX_DELIVERED_CHUNKS} chunks / ${MAX_DELIVERED_BYTES} bytes unacknowledged`,
      ),
    )
  }

  private dropDelivery(
    deliveryId: number,
  ): DeliveredTerminalOutput | undefined {
    const delivery = this.delivered.get(deliveryId)
    if (!delivery) return undefined
    this.delivered.delete(deliveryId)
    this.deliveredBytes -= delivery.output.data.length
    this.overflowReported = false
    return delivery
  }

  private reclaim(listener: TerminalSessionListener): void {
    const reclaimed: BufferedTerminalOutput[] = []
    for (const [deliveryId, delivery] of this.delivered) {
      if (delivery.listener !== listener) continue
      this.dropDelivery(deliveryId)
      reclaimed.push(delivery.output)
    }
    if (reclaimed.length > 0) {
      this.buffered = [...reclaimed, ...this.buffered]
      trimUncontrolledOutput(this.buffered)
    }
  }
}

export class TerminalSessionOutputBuffer {
  private readonly pending = new Map<string, ShellOutput[]>()
  private readonly retired = new Set<string>()

  add(output: ShellOutput): void {
    if (this.retired.has(output.session_id)) return
    const items = this.pending.get(output.session_id) ?? []
    items.push(output)
    if (!hasBackendFlowControl(output)) {
      trimUncontrolledOutput(items)
    }
    this.pending.set(output.session_id, items)
    trimPendingSessions(this.pending)
  }

  take(sessionId: string): ShellOutput[] {
    const items = this.pending.get(sessionId) ?? []
    this.pending.delete(sessionId)
    return items
  }

  activate(sessionId: string): void {
    this.retired.delete(sessionId)
  }

  retire(sessionId: string): void {
    this.pending.delete(sessionId)
    this.retired.add(sessionId)
    if (this.retired.size > 1024) {
      const oldest = this.retired.values().next().value
      if (oldest) this.retired.delete(oldest)
    }
  }
}
