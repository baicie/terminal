import type { TabType } from '../types'
import { serialService } from './serial'
import { terminalSessionTransport } from './terminal-session-transport'

const MAX_INPUT_BYTES = 1024 * 1024
const encoder = new TextEncoder()

type InputChunk =
  | { kind: 'text'; data: string; bytes: number }
  | { kind: 'raw'; data: Uint8Array; bytes: number }

export interface TerminalSize {
  cols: number
  rows: number
}

type IoState = 'connecting' | 'connected' | 'disconnected' | 'closed'

export interface TerminalSessionIoSnapshot {
  state: IoState
  acceptedBytes: number
  sentBytes: number
  queuedBytes: number
  queuedChunks: number
  writeInFlight: boolean
}

export class TerminalSessionIo {
  private state: IoState = 'connecting'
  private sessionId: string | null = null
  private generation = 0
  private readonly inputQueue: InputChunk[] = []
  private inputBytes = 0
  private acceptedBytes = 0
  private sentBytes = 0
  private pendingResize: TerminalSize | null = null
  private inputDrainGeneration: number | null = null
  private resizeDrainGeneration: number | null = null
  private latestSize: TerminalSize

  constructor(
    private readonly tabType: TabType,
    initialSize: TerminalSize,
    private readonly onError: (error: unknown) => void,
  ) {
    this.latestSize = initialSize
  }

  get size(): TerminalSize {
    return this.latestSize
  }

  snapshot(): TerminalSessionIoSnapshot {
    return {
      state: this.state,
      acceptedBytes: this.acceptedBytes,
      sentBytes: this.sentBytes,
      queuedBytes: this.inputBytes,
      queuedChunks: this.inputQueue.length,
      writeInFlight: this.inputDrainGeneration !== null,
    }
  }

  write(data: string): void {
    if (!data || (this.state !== 'connecting' && this.state !== 'connected')) {
      return
    }
    const chunk = {
      kind: 'text' as const,
      data,
      bytes: encoder.encode(data).byteLength,
    }
    if (this.inputBytes + chunk.bytes > MAX_INPUT_BYTES) {
      this.disconnect()
      this.onError(new Error('Terminal input queue exceeded 1 MiB'))
      return
    }
    this.inputQueue.push(chunk)
    this.inputBytes += chunk.bytes
    this.acceptedBytes += chunk.bytes
    void this.drainInput()
  }

  writeRaw(data: Uint8Array): void {
    if (
      data.byteLength === 0 ||
      (this.state !== 'connecting' && this.state !== 'connected')
    ) {
      return
    }
    const chunk = {
      kind: 'raw' as const,
      data: new Uint8Array(data),
      bytes: data.byteLength,
    }
    if (this.inputBytes + chunk.bytes > MAX_INPUT_BYTES) {
      this.disconnect()
      this.onError(new Error('Terminal input queue exceeded 1 MiB'))
      return
    }
    this.inputQueue.push(chunk)
    this.inputBytes += chunk.bytes
    this.acceptedBytes += chunk.bytes
    void this.drainInput()
  }

  resize(cols: number, rows: number): void {
    if (
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < 1 ||
      rows < 1
    ) {
      return
    }
    this.latestSize = { cols, rows }
    if (this.state !== 'connected' || this.tabType === 'serial') return
    this.pendingResize = this.latestSize
    void this.drainResize()
  }

  connect(sessionId: string): void {
    if (this.state === 'closed') return
    this.sessionId = sessionId
    this.state = 'connected'
    this.pendingResize = this.tabType === 'serial' ? null : this.latestSize
    void this.drainResize()
    void this.drainInput()
  }

  prepareForReconnect(): void {
    if (this.state === 'closed') return
    this.clearPendingIo()
    this.state = 'connecting'
  }

  prepareForAutomaticReconnect(): void {
    if (this.state === 'closed') return
    this.clearPendingIo()
    this.state = 'disconnected'
  }

  disconnect(): void {
    if (this.state === 'closed' || this.state === 'disconnected') return
    this.clearPendingIo()
    this.state = 'disconnected'
  }

  close(): void {
    if (this.state === 'closed') return
    this.clearPendingIo()
    this.state = 'closed'
  }

  private clearPendingIo(): void {
    this.generation++
    this.sessionId = null
    this.inputQueue.length = 0
    this.inputBytes = 0
    this.pendingResize = null
  }

  private async drainInput(): Promise<void> {
    const generation = this.generation
    if (
      this.inputDrainGeneration === generation ||
      this.state !== 'connected' ||
      !this.sessionId
    ) {
      return
    }
    this.inputDrainGeneration = generation
    try {
      while (
        generation === this.generation &&
        this.state === 'connected' &&
        this.sessionId &&
        this.inputQueue.length > 0
      ) {
        const sessionId = this.sessionId
        const chunk = this.inputQueue[0]
        if (!chunk) continue
        await this.writeChunk(sessionId, chunk)
        this.sentBytes += chunk.bytes
        if (generation !== this.generation) return
        this.inputQueue.shift()
        this.inputBytes -= chunk.bytes
      }
    } catch (error) {
      if (generation === this.generation) {
        this.disconnect()
        this.onError(error)
      }
    } finally {
      if (this.inputDrainGeneration === generation) {
        this.inputDrainGeneration = null
        if (this.state === 'connected' && this.inputQueue.length > 0) {
          void this.drainInput()
        }
      }
    }
  }

  private async drainResize(): Promise<void> {
    const generation = this.generation
    if (
      this.resizeDrainGeneration === generation ||
      this.state !== 'connected' ||
      this.tabType === 'serial' ||
      !this.sessionId
    ) {
      return
    }
    this.resizeDrainGeneration = generation
    try {
      while (
        generation === this.generation &&
        this.state === 'connected' &&
        this.sessionId &&
        this.pendingResize
      ) {
        const sessionId = this.sessionId
        const size = this.pendingResize
        this.pendingResize = null
        await terminalSessionTransport.resize(sessionId, size.cols, size.rows)
      }
    } catch (error) {
      if (generation === this.generation) {
        this.disconnect()
        this.onError(error)
      }
    } finally {
      if (this.resizeDrainGeneration === generation) {
        this.resizeDrainGeneration = null
        if (this.state === 'connected' && this.pendingResize) {
          void this.drainResize()
        }
      }
    }
  }

  private async writeChunk(
    sessionId: string,
    chunk: InputChunk,
  ): Promise<void> {
    if (chunk.kind === 'raw') {
      if (this.tabType === 'serial') {
        await serialService.writeRaw(sessionId, chunk.data)
      } else {
        await terminalSessionTransport.writeRaw(sessionId, chunk.data)
      }
      return
    }
    if (this.tabType === 'serial') {
      await serialService.write(sessionId, chunk.data)
    } else {
      await terminalSessionTransport.write(sessionId, chunk.data)
    }
  }
}
