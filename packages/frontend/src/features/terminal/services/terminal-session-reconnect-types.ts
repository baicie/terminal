import type { TerminalSessionOutputBuffer } from './terminal-session-output-buffer'
import type { TerminalRecord } from './terminal-session-manager-types'

export type TerminalReconnectStartResult =
  | 'connected'
  | 'cancelled'
  | { status: 'retry'; error: string }
  | { status: 'failed'; error: string; retryable: boolean }

export interface TerminalReconnectOptions {
  baseDelayMs?: number
  maxDelayMs?: number
  maxAttempts?: number
  recoveryDelayMs?: number
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>
  jitter?: (delayMs: number, attempt: number) => number
  now?: () => number
}

export interface TerminalReconnectDependencies {
  sessionToTab: Map<string, string>
  pendingOutput: TerminalSessionOutputBuffer
  retireLifecycle: (sessionId: string) => void
  cancelConnection: (record: TerminalRecord) => void
  start: (
    record: TerminalRecord,
    generation: number,
    signal: AbortSignal,
  ) => Promise<TerminalReconnectStartResult>
  isCurrent: (record: TerminalRecord) => boolean
}
