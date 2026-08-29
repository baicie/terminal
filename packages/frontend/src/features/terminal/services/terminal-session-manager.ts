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
import { startTerminalShell } from './terminal-launcher'
import { updateTerminalState } from './terminal-session-state'
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
    () => this.handleLifecycleOverflow(),
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
    if (record.startPromise) pending.add(record.startPromise)
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
  private beginStart(
    record: TerminalRecord,
    generation = ++record.generation,
  ): Promise<TerminalReconnectStartResult> {
    const promise = this.start(record, generation)
    record.startPromise = promise
    void promise.finally(() => {
      if (record.startPromise === promise) record.startPromise = null
    })
    return promise
  }
  private async start(
    record: TerminalRecord,
    generation: number,
  ): Promise<TerminalReconnectStartResult> {
    if (record.status !== 'reconnecting') {
      updateTerminalState(record, { status: 'connecting', error: null })
    }
    try {
      await this.events.ensure(record.request.tabType)
      const { cols, rows } = record.io.size
      const sessionId = await startTerminalShell(
        record.request.tabType,
        record.request.host,
        record.request.serialSessionId,
        cols,
        rows,
        record.request.jumpHost,
        record.request.expectedHostKey,
        record.request.expectedJumpHostKey,
      )
      if (
        record.closed ||
        record.generation !== generation ||
        this.records.get(record.request.tabId) !== record
      ) {
        this.pendingOutput.retire(sessionId)
        this.lifecycle.retire(sessionId)
        await closeTerminalBackend(record.request.tabType, sessionId)
        return 'cancelled'
      }
      record.sessionId = sessionId
      this.pendingOutput.activate(sessionId)
      this.lifecycle.activate(sessionId)
      this.sessionToTab.set(sessionId, record.request.tabId)
      const pendingLifecycle = this.lifecycle.take(sessionId)
      if (pendingLifecycle) {
        this.flushPendingOutput(record, sessionId)
        this.lifecycle.apply(sessionId, pendingLifecycle)
        if (pendingLifecycle.kind === 'close') {
          this.reconnects.automatic(
            record,
            'SSH connection closed unexpectedly',
          )
        }
        if (pendingLifecycle.kind === 'exit') return 'cancelled'
        const failure = classifyTerminalFailure(pendingLifecycle.message)
        return { status: 'failed', ...failure }
      }
      record.io.connect(sessionId)
      updateTerminalState(record, { status: 'connected', sessionId })
      this.flushPendingOutput(record, sessionId)
      return 'connected'
    } catch (error) {
      if (record.closed || record.generation !== generation) return 'cancelled'
      record.io.disconnect()
      const failure = classifyTerminalFailure(error)
      if (!record.reconnectMode) {
        updateTerminalState(record, {
          status: 'error',
          sessionId: null,
          ...failure,
        })
      }
      return { status: 'failed', ...failure }
    }
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
  private handleLifecycleOverflow(): void {
    const error = new Error('Terminal lifecycle buffer exceeded 1024 pending sessions')
    for (const [tabId, record] of this.records) {
      if (record.status === 'connecting') this.handleIoError(tabId, error)
    }
  }
}
export const terminalSessionManager = new TerminalSessionManager()
