import type { TerminalRecord } from './terminal-session-manager-types'
import type { TerminalSessionOutputBuffer } from './terminal-session-output-buffer'
import { markTerminalTerminated } from './terminal-session-state'

const MAX_PENDING_LIFECYCLES = 1024
const LIFECYCLE_OVERFLOW_MESSAGE =
  'Terminal lifecycle buffer exceeded 1024 pending sessions'

export type PendingTerminalLifecycle =
  | { kind: 'close'; message: string }
  | { kind: 'exit'; message: string }
  | { kind: 'error'; message: string }

function lifecyclePriority(lifecycle: PendingTerminalLifecycle): number {
  if (lifecycle.kind === 'error') return 3
  if (lifecycle.kind === 'exit') return 2
  return 1
}

/** Preserves lifecycle events that race the session-create IPC response. */
export class TerminalSessionLifecycleBuffer {
  private readonly pending = new Map<string, PendingTerminalLifecycle>()
  private readonly retired = new Set<string>()
  private overflowed = false

  add(sessionId: string, lifecycle: PendingTerminalLifecycle): boolean {
    if (this.retired.has(sessionId)) return true
    if (this.overflowed) return false
    const existing = this.pending.get(sessionId)
    if (existing && lifecyclePriority(existing) > lifecyclePriority(lifecycle)) {
      return true
    }
    if (!existing && this.pending.size >= MAX_PENDING_LIFECYCLES) {
      this.pending.clear()
      this.overflowed = true
      return false
    }
    this.pending.delete(sessionId)
    this.pending.set(sessionId, lifecycle)
    return true
  }

  take(sessionId: string): PendingTerminalLifecycle | undefined {
    if (this.overflowed) {
      return { kind: 'error', message: LIFECYCLE_OVERFLOW_MESSAGE }
    }
    const lifecycle = this.pending.get(sessionId)
    this.pending.delete(sessionId)
    return lifecycle
  }

  activate(sessionId: string): void {
    this.retired.delete(sessionId)
  }

  retire(sessionId: string): void {
    this.pending.delete(sessionId)
    this.retired.delete(sessionId)
    this.retired.add(sessionId)
    this.trim(this.retired)
  }

  private trim(collection: Map<string, unknown> | Set<string>): void {
    while (collection.size > MAX_PENDING_LIFECYCLES) {
      const oldest = collection.keys().next().value
      if (oldest === undefined) return
      collection.delete(oldest)
    }
  }
}

type RecordLookup = (tabId: string) => TerminalRecord | undefined
type ErrorHandler = (tabId: string, error: Error) => void
type OverflowHandler = () => void

export class TerminalSessionLifecycle {
  private readonly buffer = new TerminalSessionLifecycleBuffer()

  constructor(
    private readonly sessionToTab: Map<string, string>,
    private readonly pendingOutput: TerminalSessionOutputBuffer,
    private readonly findRecord: RecordLookup,
    private readonly handleError: ErrorHandler,
    private readonly handleOverflow: OverflowHandler,
  ) {}

  close(sessionId: string): void {
    this.apply(sessionId, {
      kind: 'close',
      message: '\r\n[disconnected]\r\n',
    })
  }

  exit(sessionId: string, exitCode: number): void {
    this.apply(sessionId, {
      kind: 'exit',
      message: `\r\n[process exited with code ${exitCode}]\r\n`,
    })
  }

  error(sessionId: string, message: string): void {
    this.apply(sessionId, { kind: 'error', message })
  }

  activate(sessionId: string): void {
    this.buffer.activate(sessionId)
  }

  take(sessionId: string): PendingTerminalLifecycle | undefined {
    return this.buffer.take(sessionId)
  }

  retire(sessionId: string): void {
    this.buffer.retire(sessionId)
  }

  apply(sessionId: string, lifecycle: PendingTerminalLifecycle): void {
    const tabId = this.sessionToTab.get(sessionId)
    const record = tabId ? this.findRecord(tabId) : undefined
    if (!record || !tabId) {
      if (!this.buffer.add(sessionId, lifecycle)) this.handleOverflow()
      return
    }
    this.buffer.retire(sessionId)
    if (lifecycle.kind === 'error') {
      this.handleError(tabId, new Error(lifecycle.message))
      return
    }
    this.sessionToTab.delete(sessionId)
    this.pendingOutput.retire(sessionId)
    markTerminalTerminated(record, lifecycle.message)
  }
}
