import type { Host } from '@/types'
import type { TabType } from '../types'
import type {
  TerminalSessionIo,
  TerminalSessionIoSnapshot,
} from './terminal-session-io'
import type { TerminalSessionAudience } from './terminal-session-output-buffer'

export type TerminalSessionStatus =
  | 'idle'
  | 'connecting'
  | 'reconnecting'
  | 'connected'
  | 'disconnected'
  | 'error'

export interface TerminalSessionRequest {
  tabId: string
  workspaceId?: string
  tabType: TabType
  host?: Host
  jumpHost?: Host
  expectedHostKey?: string
  expectedJumpHostKey?: string
  serialSessionId?: string
  cols: number
  rows: number
}

function hashPin(pin: string | undefined): string {
  let pinnedKeyHash = 2166136261
  for (const char of pin ?? '') {
    pinnedKeyHash ^= char.codePointAt(0) ?? 0
    pinnedKeyHash = Math.imul(pinnedKeyHash, 16777619)
  }
  return (pinnedKeyHash >>> 0).toString(16)
}

export function getTerminalRequestKey(request: TerminalSessionRequest): string {
  const requestKey = [
    request.tabId,
    request.tabType,
    request.host?.id ?? '',
    request.host?.updatedAt ?? '',
    request.jumpHost?.id ?? '',
    request.jumpHost?.updatedAt ?? '',
    request.serialSessionId ?? '',
  ].join(':')
  const pinParts = []
  if (request.expectedHostKey) {
    pinParts.push(`target-pin-${hashPin(request.expectedHostKey)}`)
  }
  if (request.expectedJumpHostKey) {
    pinParts.push(`jump-pin-${hashPin(request.expectedJumpHostKey)}`)
  }
  const pinnedRequestKey =
    pinParts.length > 0 ? `${requestKey}:${pinParts.join(':')}` : requestKey
  return request.workspaceId
    ? `${request.workspaceId}:${pinnedRequestKey}`
    : pinnedRequestKey
}

export interface TerminalSessionSnapshot {
  sessionId: string | null
  status: TerminalSessionStatus
  error: string | null
  attempt?: number
  reason?: string
  nextRetryAt?: number
  retryable?: boolean
}

export interface TerminalOutputReceipt {
  isActive: () => boolean
  acknowledge: () => void
}

export interface TerminalSessionListener {
  onOutput: (
    data: string,
    bytes: number | undefined,
    receipt: TerminalOutputReceipt,
  ) => void
  onState: (snapshot: TerminalSessionSnapshot) => void
}

export interface BufferedTerminalOutput {
  sessionId?: string
  data: string
  bytes?: number
}

export interface TerminalRecord {
  request: TerminalSessionRequest
  requestKey: string
  sessionId: string | null
  status: TerminalSessionStatus
  error: string | null
  audience: TerminalSessionAudience
  io: TerminalSessionIo
  generation: number
  startPromise: Promise<unknown> | null
  reconnectPromise: Promise<void> | null
  reconnectMode: 'automatic' | 'manual' | null
  reconnectAttempt: number | null
  reconnectReason: string | null
  reconnectNextRetryAt: number | null
  retryable: boolean | null
  closed: boolean
}

export function getTerminalSnapshot(
  record: TerminalRecord,
): TerminalSessionSnapshot {
  const snapshot: TerminalSessionSnapshot = {
    sessionId: record.sessionId,
    status: record.status,
    error: record.error,
  }
  if (
    record.status === 'reconnecting' &&
    record.reconnectAttempt !== null &&
    record.reconnectReason
  ) {
    snapshot.attempt = record.reconnectAttempt
    snapshot.reason = record.reconnectReason
  }
  if (
    record.status === 'reconnecting' &&
    record.reconnectNextRetryAt !== null
  ) {
    snapshot.nextRetryAt = record.reconnectNextRetryAt
  }
  if (record.retryable !== null) snapshot.retryable = record.retryable
  return snapshot
}

export interface TerminalSessionBinding {
  getIoDiagnostics: () => TerminalSessionIoSnapshot
  write: (data: string) => void
  writeRaw: (data: Uint8Array) => void
  resize: (cols: number, rows: number) => void
  disconnect: () => void
  reconnect: () => void
  dispose: () => void
}
