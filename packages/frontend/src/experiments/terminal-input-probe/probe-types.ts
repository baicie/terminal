import type { TerminalInputDiagnosticEvent } from '@/hooks/terminal-session-types'

export interface InputEventLog {
  id: number
  kind: TerminalInputDiagnosticEvent['kind']
  hex: string
  bytes: number
}
