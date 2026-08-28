import type { ShellOutput } from '../types'
import type {
  BufferedTerminalOutput,
  TerminalOutputReceipt,
  TerminalSessionListener,
  TerminalSessionSnapshot,
} from './terminal-session-manager-types'

const MAX_BUFFERED_CHUNKS = 256
const MAX_BUFFERED_BYTES = 512 * 1024

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

interface DeliveredTerminalOutput {
  listener: TerminalSessionListener
  output: BufferedTerminalOutput
}

type BackendAcknowledger = (sessionId: string, bytes: number) => void

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

  constructor(private readonly acknowledgeBackend: BackendAcknowledger) {}

  attach(
    listener: TerminalSessionListener,
    snapshot: TerminalSessionSnapshot,
  ): void {
    this.listeners.add(listener)
    listener.onState(snapshot)
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
    for (const listener of this.listeners) listener.onState(snapshot)
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
        this.delivered.delete(deliveryId)
      }
    }
  }

  retireAll(): void {
    this.buffered.length = 0
    this.delivered.clear()
  }

  clear(): void {
    this.listeners.clear()
    this.owner = null
    this.buffered.length = 0
    this.delivered.clear()
  }

  private drain(): void {
    const listener = this.owner
    if (!listener) return
    while (this.owner === listener && this.buffered.length > 0) {
      const output = this.buffered.shift()
      if (!output) return
      const deliveryId = this.nextDeliveryId++
      this.delivered.set(deliveryId, { listener, output })
      const receipt: TerminalOutputReceipt = {
        isActive: () => {
          const delivery = this.delivered.get(deliveryId)
          return delivery?.listener === listener
        },
        acknowledge: () => this.acknowledge(deliveryId, listener),
      }
      listener.onOutput(output.data, output.bytes, receipt)
    }
  }

  private acknowledge(
    deliveryId: number,
    listener: TerminalSessionListener,
  ): void {
    const delivery = this.delivered.get(deliveryId)
    if (!delivery || delivery.listener !== listener) return
    this.delivered.delete(deliveryId)
    const { sessionId, bytes } = delivery.output
    if (
      sessionId &&
      Number.isSafeInteger(bytes) &&
      bytes !== undefined &&
      bytes > 0
    ) {
      this.acknowledgeBackend(sessionId, bytes)
    }
  }

  private reclaim(listener: TerminalSessionListener): void {
    const reclaimed: BufferedTerminalOutput[] = []
    for (const [deliveryId, delivery] of this.delivered) {
      if (delivery.listener !== listener) continue
      this.delivered.delete(deliveryId)
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
