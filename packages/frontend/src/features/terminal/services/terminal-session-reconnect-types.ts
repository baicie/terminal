import type { TerminalSessionOutputBuffer } from './terminal-session-output-buffer'
import type { TerminalRecord } from './terminal-session-manager-types'
import type {
  TerminalFailure,
  TerminalFailureDiagnosis,
  TerminalFailureHop,
  TerminalFailureRecovery,
  TerminalFailureStage,
} from './terminal-session-manager-errors'

export type TerminalReconnectStartResult =
  | 'connected'
  | 'cancelled'
  /**
   * A host wake suspended this attempt mid-handshake; run the ladder again with a fresh
   * budget.
   *
   * F06 — it carries the whole failure, not only its sentence. The restart discards the
   * attempt counter, and discarding the context with it would make a wake-during-bastion-
   * failure publish a context-free verdict if the restarted ladder never got another
   * structured answer.
   */
  | { status: 'retry'; failure: TerminalFailure }
  | {
      status: 'failed'
      error: string
      retryable: boolean
      /** Which way forward this failure has; only `automatic` keeps the loop. */
      recovery: TerminalFailureRecovery
      credentialKind?: string
      /** SSH10: which leg of a jump chain failed, when there was one. */
      hop?: TerminalFailureHop
      stage?: TerminalFailureStage
      /** SSH11: the situation worth naming, when the raw message cannot say it. */
      diagnosis?: TerminalFailureDiagnosis
    }

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
