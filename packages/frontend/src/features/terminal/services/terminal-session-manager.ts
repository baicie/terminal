import { closeTerminalBackend } from './terminal-session-backend'
import { TerminalSessionEvents } from './terminal-session-events'
import {
  classifyTerminalFailure,
  handleTerminalIoError,
} from './terminal-session-manager-errors'
import { TerminalSessionLifecycle } from './terminal-session-lifecycle-buffer'
import { createTerminalRecord } from './terminal-session-record'
import {
  terminalSessionResourceSnapshot,
  type TerminalSessionResourceSnapshot,
} from './terminal-session-manager-resources'
import {
  TerminalSessionReconnect,
  type TerminalReconnectOptions,
  type TerminalReconnectStartResult,
} from './terminal-session-manager-reconnect'
import { TerminalSessionOutputBuffer } from './terminal-session-output-buffer'
import { startTerminalSession } from './terminal-session-manager-start'
import { terminalSessionTransport } from './terminal-session-transport'
import type { ShellOutput } from '../types'
import {
  getTerminalRequestKey,
  getTerminalSnapshot,
  type TerminalRecord,
  type TerminalSessionBinding,
  type TerminalSessionListener,
  type TerminalSessionRequest,
} from './terminal-session-manager-types'

export {
  getTerminalRequestKey,
  type TerminalSessionBinding,
  type TerminalSessionRequest,
  type TerminalSessionSnapshot,
  type TerminalSessionStatus,
} from './terminal-session-manager-types'
export type { TerminalReconnectOptions } from './terminal-session-manager-reconnect'
export type { TerminalSessionResourceSnapshot } from './terminal-session-manager-resources'
export class TerminalSessionManager {
  private readonly records = new Map<string, TerminalRecord>()
  private readonly sessionToTab = new Map<string, string>()
  private readonly pendingOutput = new TerminalSessionOutputBuffer()
  private readonly lifecycle = new TerminalSessionLifecycle(
    this.sessionToTab,
    this.pendingOutput,
    tabId => this.records.get(tabId),
    (tabId, error) => this.handleIoError(tabId, error, true),
    sessionId => this.handleLifecycleOverflow(sessionId),
  )
  private readonly reconnects: TerminalSessionReconnect
  private readonly events = new TerminalSessionEvents({
    onOutput: output => this.handleOutput(output),
    onClose: sessionId => this.handleClose(sessionId),
    onExit: (sessionId, exitCode) => this.lifecycle.exit(sessionId, exitCode),
    onError: error => this.lifecycle.error(error.session_id, error.message),
  })
  constructor(options: TerminalReconnectOptions = {}) {
    this.reconnects = new TerminalSessionReconnect(
      {
        sessionToTab: this.sessionToTab,
        pendingOutput: this.pendingOutput,
        retireLifecycle: sessionId => this.lifecycle.retire(sessionId),
        cancelConnection: record => this.cancelConnection(record),
        start: (record, generation) => this.beginStart(record, generation),
        isCurrent: record => this.records.get(record.request.tabId) === record,
      },
      options,
    )
  }
  prepare(tabType: TerminalSessionRequest['tabType']): Promise<void> {
    return this.events.ensure(tabType)
  }
  resourceSnapshot(): TerminalSessionResourceSnapshot {
    return terminalSessionResourceSnapshot(this.records, this.sessionToTab)
  }
  attach(
    request: TerminalSessionRequest,
    listener: TerminalSessionListener,
  ): TerminalSessionBinding {
    let record = this.records.get(request.tabId)
    const requestKey = getTerminalRequestKey(request)
    if (
      record &&
      (record.requestKey !== requestKey ||
        record.request.expectedHostKey !== request.expectedHostKey ||
        record.request.expectedJumpHostKey !== request.expectedJumpHostKey)
    ) {
      void this.close(request.tabId)
      record = undefined
    }
    if (!record) {
      record = createTerminalRecord(request, requestKey, {
        acknowledgeOutput: (sessionId, bytes) =>
          this.ackOutput(request.tabId, sessionId, bytes),
        handleIoError: error => this.handleIoError(request.tabId, error),
      })
      this.records.set(request.tabId, record)
    }
    record.io.resize(request.cols, request.rows)
    record.audience.attach(listener, getTerminalSnapshot(record))
    if (!record.startPromise && record.status === 'idle') {
      void this.beginStart(record)
    }
    return {
      getIoDiagnostics: () => record.io.snapshot(),
      write: data => this.write(request.tabId, data),
      writeRaw: data => this.writeRaw(request.tabId, data),
      resize: (cols, rows) => this.resize(request.tabId, cols, rows),
      disconnect: () => void this.disconnect(request.tabId),
      reconnect: () => void this.reconnect(request.tabId),
      dispose: () => {
        record?.audience.detach(listener)
      },
    }
  }
  private writeRaw(tabId: string, data: Uint8Array): void {
    this.records.get(tabId)?.io.writeRaw(data)
  }
  async close(tabId: string): Promise<void> {
    const record = this.records.get(tabId)
    if (!record) return
    const pending = new Set<Promise<unknown>>()
    for (const promise of record.startPromises) pending.add(promise)
    if (record.reconnectPromise) pending.add(record.reconnectPromise)
    record.closed = true
    this.reconnects.retire(record)
    record.io.close()
    this.records.delete(tabId)
    record.audience.clear()
    if (record.sessionId) {
      this.sessionToTab.delete(record.sessionId)
      this.pendingOutput.retire(record.sessionId)
      this.lifecycle.retire(record.sessionId)
      record.audience.retire(record.sessionId)
      await closeTerminalBackend(record.request.tabType, record.sessionId)
    }
    await Promise.allSettled(pending)
  }
  prune(tabIds: Set<string>): void {
    for (const tabId of this.records.keys()) {
      if (!tabIds.has(tabId)) void this.close(tabId)
    }
  }
  /**
   * Re-arm automatic reconnect for every remote session left in a retryable
   * error state. Called when the window becomes visible again after sleep,
   * because a suspended host spends the whole retry budget without the backend
   * emitting another event to trigger recovery.
   */
  handleHostWake(): void {
    for (const record of this.records.values()) {
      if (this.reconnects.resume(record, 'Resumed after host wake')) continue
      // Waking resumes timers and the socket at the same time, so an in-flight
      // attempt is often still connecting when the wake arrives and only fails
      // a moment later. That failure carries no sessionId, so the ordinary
      // I/O-error path cannot re-arm it and the pane would stay stuck. Arm the
      // recovery now so the post-wake failure restarts a fresh attempt budget.
      this.reconnects.armAfterWake(record)
    }
  }
  private beginStart(
    record: TerminalRecord,
    generation = ++record.generation,
  ): Promise<TerminalReconnectStartResult> {
    const promise = this.start(record, generation)
    record.startPromise = promise
    record.startPromises.add(promise)
    void promise.finally(() => {
      record.startPromises.delete(promise)
      if (record.startPromise === promise) record.startPromise = null
    })
    return promise
  }
  private start(
    record: TerminalRecord,
    generation: number,
  ): Promise<TerminalReconnectStartResult> {
    return startTerminalSession(
      {
        events: this.events,
        records: this.records,
        sessionToTab: this.sessionToTab,
        pendingOutput: this.pendingOutput,
        lifecycle: this.lifecycle,
        reconnects: this.reconnects,
        flushPendingOutput: (startRecord, sessionId) =>
          this.flushPendingOutput(startRecord, sessionId),
      },
      record,
      generation,
    )
  }

  private cancelConnection(record: TerminalRecord): void {
    const attemptId = record.connectionAttemptId
    if (!attemptId) return
    record.connectionAttemptId = null
    void terminalSessionTransport.cancelConnection(attemptId).catch(error => {
      // Cancellation is best effort: generation retirement still prevents a
      // late session from being published if the backend has already finished.
      console.debug('SSH connection cancellation request failed', error)
    })
  }
  private handleOutput(output: ShellOutput): void {
    const tabId = this.sessionToTab.get(output.session_id)
    if (!tabId) {
      this.pendingOutput.add(output)
      return
    }
    const record = this.records.get(tabId)
    if (!record) return
    record.audience.enqueue(output)
  }
  private flushPendingOutput(record: TerminalRecord, sessionId: string): void {
    for (const output of this.pendingOutput.take(sessionId)) {
      record.audience.enqueue(output)
    }
  }
  private write(tabId: string, data: string): void {
    this.records.get(tabId)?.io.write(data)
  }
  private ackOutput(tabId: string, sessionId: string, bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes <= 0) return
    const record = this.records.get(tabId)
    if (!record || record.request.tabType === 'serial') return
    void terminalSessionTransport.ackOutput(sessionId, bytes).catch(error => {
      if (this.records.get(tabId)?.sessionId === sessionId) {
        this.handleIoError(tabId, error)
      }
    })
  }
  private resize(tabId: string, cols: number, rows: number): void {
    this.records.get(tabId)?.io.resize(cols, rows)
  }
  private async disconnect(tabId: string): Promise<void> {
    const record = this.records.get(tabId)
    if (record) await this.reconnects.disconnect(record)
  }
  private reconnect(tabId: string): void {
    const record = this.records.get(tabId)
    if (record) this.reconnects.manual(record)
  }
  private handleIoError(
    tabId: string,
    error: unknown,
    preserveAudienceOutput = false,
  ): void {
    const record = this.records.get(tabId)
    const failure = classifyTerminalFailure(error)
    const shouldReconnect =
      record?.request.tabType === 'remote' &&
      Boolean(record.sessionId) &&
      failure.retryable
    if (record) this.cancelConnection(record)
    if (record?.sessionId) this.lifecycle.retire(record.sessionId)
    handleTerminalIoError(
      record,
      error,
      this.sessionToTab,
      this.pendingOutput,
      preserveAudienceOutput,
      failure,
    )
    if (record && shouldReconnect) {
      this.reconnects.automatic(record, failure.error)
    }
  }
  private handleClose(sessionId: string): void {
    const tabId = this.sessionToTab.get(sessionId)
    const record = tabId ? this.records.get(tabId) : undefined
    this.lifecycle.close(sessionId)
    if (record) {
      this.reconnects.automatic(record, 'SSH connection closed unexpectedly')
    }
  }
  private handleLifecycleOverflow(sessionId: string): void {
    const error = new Error('Terminal lifecycle buffer exceeded 1024 pending sessions')
    const tabId = this.sessionToTab.get(sessionId)
    if (tabId) this.handleIoError(tabId, error)
  }
}
export const terminalSessionManager = new TerminalSessionManager()
