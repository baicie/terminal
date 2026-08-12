import type { Host } from '@/types'
import type { ShellOutput, TabType } from '../types'

export type TerminalSessionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'

export interface TerminalSessionRequest {
  tabId: string
  tabType: TabType
  host?: Host
  jumpHost?: Host
  serialSessionId?: string
  cols: number
  rows: number
}

export interface TerminalSessionSnapshot {
  sessionId: string | null
  status: TerminalSessionStatus
  error: string | null
}

export interface TerminalSessionListener {
  onOutput: (data: string) => void
  onState: (snapshot: TerminalSessionSnapshot) => void
}

export interface TerminalRecord {
  request: TerminalSessionRequest
  requestKey: string
  sessionId: string | null
  status: TerminalSessionStatus
  error: string | null
  listeners: Set<TerminalSessionListener>
  bufferedOutput: string[]
  startPromise: Promise<void> | null
  closed: boolean
}

export interface TerminalSessionBinding {
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  disconnect: () => void
  reconnect: () => void
  dispose: () => void
}

export type PendingTerminalOutput = Map<string, ShellOutput[]>
