import { formatIpcError } from '@/hooks/terminal-session-helpers'
import { closeTerminalBackend } from './terminal-session-backend'
import type { TerminalSessionOutputBuffer } from './terminal-session-output-buffer'
import { updateTerminalState } from './terminal-session-state'
import type { TerminalRecord } from './terminal-session-manager-types'

export type TerminalReconnectStartResult =
  | 'connected'
  | 'cancelled'
  | { status: 'failed'; error: string; retryable: boolean }

export interface TerminalReconnectOptions {
  baseDelayMs?: number
  maxDelayMs?: number
  maxAttempts?: number
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>
  jitter?: (delayMs: number, attempt: number) => number
  now?: () => number
}

interface TerminalReconnectDependencies {
  sessionToTab: Map<string, string>
  pendingOutput: TerminalSessionOutputBuffer
  retireLifecycle: (sessionId: string) => void
  start: (
    record: TerminalRecord,
    generation: number,
  ) => Promise<TerminalReconnectStartResult>
  isCurrent: (record: TerminalRecord) => boolean
}

const defaultSleep = (delayMs: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Reconnect cancelled', 'AbortError'))
      },
      { once: true },
    )
  })

const defaultJitter = (delayMs: number) =>
  Math.round(delayMs * (0.8 + Math.random() * 0.4))

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value !== undefined && value > 0
    ? value
    : fallback
}

export class TerminalSessionReconnect {
  private readonly baseDelayMs: number
  private readonly maxDelayMs: number
  private readonly maxAttempts: number
  private readonly sleep: (
    delayMs: number,
    signal?: AbortSignal,
  ) => Promise<void>
  private readonly jitter: (delayMs: number, attempt: number) => number
  private readonly now: () => number
  private readonly abortControllers = new WeakMap<
    TerminalRecord,
    AbortController
  >()

  constructor(
    private readonly dependencies: TerminalReconnectDependencies,
    options: TerminalReconnectOptions = {},
  ) {
    this.baseDelayMs = positiveInteger(options.baseDelayMs, 500)
    this.maxDelayMs = positiveInteger(options.maxDelayMs, 10_000)
    this.maxAttempts = positiveInteger(options.maxAttempts, 5)
    this.sleep = options.sleep ?? defaultSleep
    this.jitter = options.jitter ?? defaultJitter
    this.now = options.now ?? Date.now
  }

  async disconnect(record: TerminalRecord): Promise<void> {
    this.cancel(record)
    const sessionId = this.prepare(record, false)
    record.io.disconnect()
    updateTerminalState(record, { status: 'disconnected', sessionId: null })
    if (sessionId) {
      await closeTerminalBackend(record.request.tabType, sessionId)
    }
  }

  retire(record: TerminalRecord): void {
    this.cancel(record)
  }

  manual(record: TerminalRecord): void {
    if (record.closed || record.reconnectMode === 'manual') return
    if (record.request.tabType === 'serial') {
      updateTerminalState(record, {
        error: 'Reconnect serial ports from the serial connection dialog.',
      })
      return
    }
    this.launch(record, 'manual', 'Manual reconnect')
  }

  automatic(record: TerminalRecord, reason: string): void {
    if (
      record.closed ||
      record.request.tabType !== 'remote' ||
      record.reconnectPromise
    ) {
      return
    }
    this.launch(record, 'automatic', reason)
  }

  private cancel(record: TerminalRecord): void {
    this.abortControllers.get(record)?.abort()
    this.abortControllers.delete(record)
    record.generation++
    record.reconnectPromise = null
    record.reconnectMode = null
  }

  private launch(
    record: TerminalRecord,
    mode: NonNullable<TerminalRecord['reconnectMode']>,
    reason: string,
  ): void {
    this.abortControllers.get(record)?.abort()
    const controller = new AbortController()
    this.abortControllers.set(record, controller)
    const promise = this.run(record, mode, reason, controller.signal)
    record.reconnectMode = mode
    record.reconnectPromise = promise
    void promise.finally(() => {
      if (record.reconnectPromise !== promise) return
      record.reconnectPromise = null
      record.reconnectMode = null
      if (this.abortControllers.get(record) === controller) {
        this.abortControllers.delete(record)
      }
    })
  }

  private async run(
    record: TerminalRecord,
    mode: NonNullable<TerminalRecord['reconnectMode']>,
    reason: string,
    signal: AbortSignal,
  ): Promise<void> {
    const generation = ++record.generation
    const sessionId = this.prepare(record, mode)
    const attempts = mode === 'automatic' ? this.maxAttempts : 1
    let lastError = reason

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) this.prepareIo(record, mode)
      const delay = mode === 'automatic' ? this.delayFor(attempt) : 0
      updateTerminalState(record, {
        status: 'reconnecting',
        sessionId: null,
        error: null,
        attempt,
        reason: lastError,
        nextRetryAt: mode === 'automatic' ? this.now() + delay : undefined,
        retryable: true,
      })
      if (attempt === 1 && sessionId) {
        await closeTerminalBackend(record.request.tabType, sessionId)
      }
      if (!this.isActive(record, generation)) return

      if (mode === 'automatic') {
        try {
          await this.sleep(delay, signal)
        } catch (error) {
          if (signal.aborted || !this.isActive(record, generation)) return
          if (this.isActive(record, generation)) {
            updateTerminalState(record, {
              status: 'error',
              error: formatIpcError(error),
              retryable: true,
            })
          }
          return
        }
      }
      if (!this.isActive(record, generation)) return

      const result = await this.dependencies.start(record, generation)
      if (result === 'connected' || result === 'cancelled') return
      lastError = result.error
      if (!result.retryable) {
        updateTerminalState(record, {
          status: 'error',
          sessionId: null,
          error: result.error,
          retryable: false,
        })
        return
      }
    }
    if (!this.isActive(record, generation)) return
    updateTerminalState(record, {
      status: 'error',
      sessionId: null,
      error: lastError,
      retryable: true,
    })
  }

  private prepare(
    record: TerminalRecord,
    mode: NonNullable<TerminalRecord['reconnectMode']> | false,
  ): string | null {
    const sessionId = record.sessionId
    record.sessionId = null
    if (mode) {
      record.audience.retireAll()
      this.prepareIo(record, mode)
    }
    if (!sessionId) return null
    this.dependencies.sessionToTab.delete(sessionId)
    this.dependencies.pendingOutput.retire(sessionId)
    this.dependencies.retireLifecycle(sessionId)
    record.audience.retire(sessionId)
    return sessionId
  }

  private prepareIo(
    record: TerminalRecord,
    mode: NonNullable<TerminalRecord['reconnectMode']>,
  ): void {
    if (mode === 'automatic') record.io.prepareForAutomaticReconnect()
    else record.io.prepareForReconnect()
  }

  private delayFor(attempt: number): number {
    const exponential = Math.min(
      this.maxDelayMs,
      this.baseDelayMs * 2 ** (attempt - 1),
    )
    const jittered = this.jitter(exponential, attempt)
    return Number.isFinite(jittered) && jittered >= 0
      ? Math.round(jittered)
      : exponential
  }

  private isActive(record: TerminalRecord, generation: number): boolean {
    return (
      !record.closed &&
      record.generation === generation &&
      this.dependencies.isCurrent(record)
    )
  }
}
