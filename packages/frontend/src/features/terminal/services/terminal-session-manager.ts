import { sanitizeTerminalOutput } from '@/hooks/terminal-session-helpers'
import { sessionService } from './session'
import { TerminalSessionEvents } from './terminal-session-events'
import { startTerminalShell } from './terminal-launcher'
import type { ShellOutput } from '../types'
import type {
  PendingTerminalOutput,
  TerminalRecord,
  TerminalSessionBinding,
  TerminalSessionListener,
  TerminalSessionRequest,
  TerminalSessionSnapshot,
} from './terminal-session-manager-types'

export type {
  TerminalSessionBinding,
  TerminalSessionRequest,
  TerminalSessionSnapshot,
  TerminalSessionStatus,
} from './terminal-session-manager-types'

const MAX_BUFFERED_CHUNKS = 256
const MAX_BUFFERED_BYTES = 512 * 1024

export function getTerminalRequestKey(request: TerminalSessionRequest): string {
  return [
    request.tabId,
    request.tabType,
    request.host?.id ?? '',
    request.jumpHost?.id ?? '',
    request.serialSessionId ?? '',
  ].join(':')
}

export class TerminalSessionManager {
  private readonly records = new Map<string, TerminalRecord>()
  private readonly sessionToTab = new Map<string, string>()
  private readonly pendingBySession: PendingTerminalOutput = new Map()
  private readonly events = new TerminalSessionEvents({
    onOutput: output => this.handleOutput(output),
    onClose: sessionId => this.handleClose(sessionId),
    onExit: (sessionId, exitCode) => this.handleExit(sessionId, exitCode),
  })

  attach(
    request: TerminalSessionRequest,
    listener: TerminalSessionListener,
  ): TerminalSessionBinding {
    let record = this.records.get(request.tabId)
    const requestKey = getTerminalRequestKey(request)
    if (record && record.requestKey !== requestKey) {
      void this.close(request.tabId)
      record = undefined
    }
    if (!record) {
      record = {
        request,
        requestKey,
        sessionId: null,
        status: 'idle',
        error: null,
        listeners: new Set(),
        bufferedOutput: [],
        startPromise: null,
        closed: false,
      }
      this.records.set(request.tabId, record)
    }

    record.listeners.add(listener)
    listener.onState(this.snapshot(record))
    if (record.bufferedOutput.length > 0) {
      const bufferedOutput = record.bufferedOutput.splice(0)
      for (const data of bufferedOutput) listener.onOutput(data)
    }
    if (!record.startPromise && record.status === 'idle') {
      record.startPromise = this.start(record).finally(() => {
        record.startPromise = null
      })
    }

    return {
      write: data => this.write(request.tabId, data),
      resize: (cols, rows) => this.resize(request.tabId, cols, rows),
      disconnect: () => void this.disconnect(request.tabId),
      reconnect: () => void this.reconnect(request.tabId),
      dispose: () => {
        record?.listeners.delete(listener)
      },
    }
  }

  async close(tabId: string): Promise<void> {
    const record = this.records.get(tabId)
    if (!record) return
    record.closed = true
    this.records.delete(tabId)
    if (record.sessionId) {
      this.sessionToTab.delete(record.sessionId)
      this.pendingBySession.delete(record.sessionId)
      if (record.request.tabType !== 'serial') {
        await sessionService.close(record.sessionId).catch(() => {})
      }
    }
    record.listeners.clear()
    record.bufferedOutput.length = 0
  }

  prune(tabIds: Set<string>): void {
    for (const tabId of this.records.keys()) {
      if (!tabIds.has(tabId)) void this.close(tabId)
    }
  }

  private async start(record: TerminalRecord): Promise<void> {
    this.setState(record, { status: 'connecting', error: null })
    try {
      await this.events.ensure(record.request.tabType)
      const sessionId = await startTerminalShell(
        record.request.tabType,
        record.request.host,
        record.request.serialSessionId,
        record.request.cols,
        record.request.rows,
        record.request.jumpHost,
      )

      if (record.closed || this.records.get(record.request.tabId) !== record) {
        if (record.request.tabType !== 'serial') {
          await sessionService.close(sessionId).catch(() => {})
        }
        return
      }

      record.sessionId = sessionId
      this.sessionToTab.set(sessionId, record.request.tabId)
      this.setState(record, { status: 'connected', sessionId })
      this.flushPendingOutput(record, sessionId)

      if (record.request.tabType !== 'serial') {
        await this.resize(
          record.request.tabId,
          record.request.cols,
          record.request.rows,
        )
      }
    } catch (error) {
      if (record.closed) return
      this.setState(record, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private handleOutput(output: ShellOutput): void {
    const tabId = this.sessionToTab.get(output.session_id)
    if (!tabId) {
      const pending = this.pendingBySession.get(output.session_id) ?? []
      pending.push(output)
      if (pending.length > MAX_BUFFERED_CHUNKS) pending.shift()
      while (
        pending.reduce((total, item) => total + item.data.length, 0) >
        MAX_BUFFERED_BYTES
      ) {
        pending.shift()
      }
      this.pendingBySession.set(output.session_id, pending)
      return
    }
    const record = this.records.get(tabId)
    if (!record) return
    this.deliver(record, sanitizeTerminalOutput(output.data))
  }

  private handleClose(sessionId: string): void {
    const record = this.findRecord(sessionId)
    if (!record) return
    this.sessionToTab.delete(sessionId)
    this.pendingBySession.delete(sessionId)
    record.sessionId = null
    this.deliver(record, '\r\n[disconnected]\r\n')
    this.setState(record, { status: 'disconnected', sessionId: null })
  }

  private handleExit(sessionId: string, exitCode: number): void {
    const record = this.findRecord(sessionId)
    if (!record) return
    this.sessionToTab.delete(sessionId)
    this.pendingBySession.delete(sessionId)
    record.sessionId = null
    this.deliver(record, `\r\n[process exited with code ${exitCode}]\r\n`)
    this.setState(record, { status: 'disconnected', sessionId: null })
  }

  private findRecord(sessionId: string): TerminalRecord | undefined {
    const tabId = this.sessionToTab.get(sessionId)
    return tabId ? this.records.get(tabId) : undefined
  }

  private flushPendingOutput(record: TerminalRecord, sessionId: string): void {
    const pending = this.pendingBySession.get(sessionId)
    if (!pending) return
    this.pendingBySession.delete(sessionId)
    for (const output of pending) {
      this.deliver(record, sanitizeTerminalOutput(output.data))
    }
  }

  private deliver(record: TerminalRecord, data: string): void {
    if (record.listeners.size === 0) {
      record.bufferedOutput.push(data)
      while (
        record.bufferedOutput.length > MAX_BUFFERED_CHUNKS ||
        record.bufferedOutput.join('').length > MAX_BUFFERED_BYTES
      ) {
        record.bufferedOutput.shift()
      }
      return
    }
    for (const listener of record.listeners) listener.onOutput(data)
  }

  private async write(tabId: string, data: string): Promise<void> {
    const record = this.records.get(tabId)
    if (!record?.sessionId) return
    try {
      if (record.request.tabType === 'serial') {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('serial_write', { sessionId: record.sessionId, data })
      } else {
        await sessionService.write(record.sessionId, data)
      }
    } catch (error) {
      console.error('[TerminalSessionManager] write failed:', error)
    }
  }

  private async resize(
    tabId: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    const record = this.records.get(tabId)
    if (!record?.sessionId || record.request.tabType === 'serial') return
    await sessionService.resize(record.sessionId, cols, rows).catch(error => {
      console.error('[TerminalSessionManager] resize failed:', error)
    })
  }

  private async disconnect(tabId: string): Promise<void> {
    const record = this.records.get(tabId)
    if (!record?.sessionId || record.request.tabType === 'serial') return
    await sessionService.close(record.sessionId).catch(() => {})
    this.setState(record, { status: 'disconnected' })
  }

  private async reconnect(tabId: string): Promise<void> {
    const record = this.records.get(tabId)
    if (!record || record.startPromise) return
    if (record.sessionId && record.request.tabType !== 'serial') {
      await sessionService.close(record.sessionId).catch(() => {})
      this.sessionToTab.delete(record.sessionId)
    }
    record.sessionId = null
    record.error = null
    record.status = 'idle'
    record.closed = false
    record.startPromise = this.start(record).finally(() => {
      record.startPromise = null
    })
  }

  private snapshot(record: TerminalRecord): TerminalSessionSnapshot {
    return {
      sessionId: record.sessionId,
      status: record.status,
      error: record.error,
    }
  }

  private setState(
    record: TerminalRecord,
    next: Partial<TerminalSessionSnapshot>,
  ): void {
    if (next.sessionId !== undefined) record.sessionId = next.sessionId
    if (next.status !== undefined) record.status = next.status
    if (next.error !== undefined) record.error = next.error
    const snapshot = this.snapshot(record)
    for (const listener of record.listeners) listener.onState(snapshot)
  }
}

export const terminalSessionManager = new TerminalSessionManager()
