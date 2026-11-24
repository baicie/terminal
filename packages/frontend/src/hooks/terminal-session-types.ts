import type { TabType } from '@/features/terminal/types'
import type { Host } from '@/types'
import type { Terminal as XTerminal } from '@baicie/xterm'
import type { TerminalOutputSchedulerSnapshot } from '@/features/terminal/services/terminal-output-scheduler'
import type { TerminalSessionIoSnapshot } from '@/features/terminal/services/terminal-session-io'
import type {
  TerminalFailureHop,
  TerminalFailureStage,
} from '@/features/terminal/services/terminal-failure-context'
import type { TerminalFailureDiagnosis } from '@/features/terminal/services/terminal-failure-diagnostic'

export interface ShellOutput {
  session_id: string
  data: string
  is_stderr: boolean
}

export interface TerminalInputDiagnosticEvent {
  kind: 'text' | 'raw'
  data: string | Uint8Array
  bytes: number
  /**
   * False for snippet / command-palette / mobile-key-bar writes, true for
   * xterm `onData`. Recovery only treats real user input as tab ownership;
   * a programmatic write must not make a temporary fallback permanent.
   */
  wasUserInput?: boolean
}

export interface TerminalOutputDiagnosticEvent {
  data: string
  bytes: number
  backendBytes?: number
}

export interface UseTerminalOptions {
  /** Stable AppStore tab id that owns the terminal session. */
  tabId: string
  /** Workspace namespace that prevents cross-workspace session reuse. */
  workspaceId: string
  /** Tab type: local, remote, or serial. */
  tabType: TabType
  /** Prevent the backend session from starting until preflight checks pass. */
  enabled?: boolean
  /** Exact SSH public key accepted for this connection without persisting it. */
  expectedHostKey?: string
  /** Exact jump-host public key accepted without persisting it. */
  expectedJumpHostKey?: string
  /** Absolute deadline for the first session create after host-key preflight. */
  connectionDeadlineAt?: number
  /** Required when tabType is remote. */
  host?: Host
  /** Resolved host referenced by host.jumpHostId. */
  jumpHost?: Host
  /** Existing serial session ID, required when tabType is serial. */
  serialSessionId?: string
  cols?: number
  rows?: number
  /** Writer that can preserve viewport state while xterm parses output. */
  outputWriter?: Pick<XTerminal, 'write'>
  /** Optional debug-only observer; it must never transform or consume input. */
  onInput?: (event: TerminalInputDiagnosticEvent) => void
  /** Optional debug-only observer for raw output before xterm scheduling. */
  onOutput?: (event: TerminalOutputDiagnosticEvent) => void
}

export interface UseTerminalResult {
  sessionId: string | null
  status:
    | 'idle'
    | 'connecting'
    | 'reconnecting'
    | 'connected'
    | 'disconnected'
    | 'error'
  error: string | null
  attempt?: number
  reason?: string
  nextRetryAt?: number
  retryable?: boolean
  /** What a retry would take, when the failure came from the credential layer. */
  recovery?: 'automatic' | 'manual' | 'after-vault'
  /** Which credential failure this was, so the pane can offer the right fix. */
  credentialKind?: string
  /**
   * SSH11: which leg of a jump chain failed, and at what step.
   *
   * Reaching the pane is the whole point of SSH05–SSH09: a refusal on the bastion and
   * a refusal on the host behind it are two different logins, and the user can only
   * fix the right one if the pane says which. Absent means the context was not
   * recorded — never "target".
   */
  hop?: TerminalFailureHop
  stage?: TerminalFailureStage
  /** SSH11: the situation worth naming, resolved to a sentence by the pane. */
  diagnosis?: TerminalFailureDiagnosis
  getInputDiagnostics: () => TerminalSessionIoSnapshot | null
  getOutputDiagnostics: () => TerminalOutputSchedulerSnapshot | null
  write: (data: string) => void
  reconnect: () => void
  disconnect: () => void
}
