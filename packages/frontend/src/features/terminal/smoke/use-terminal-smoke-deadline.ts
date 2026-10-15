import { useEffect } from 'react'

const CONNECTION_DEADLINE_MS = 10_000
const RECONNECT_DEADLINE_MS = 30_000
const HOST_WAKE_RECONNECT_DEADLINE_MS = 90_000

interface TerminalSmokeDeadlineOptions {
  applicationStartedAt: number
  onTimeout: (deadlineMs: number, status: string) => void
  reconnectRequired: boolean
  hostWakeRequired?: boolean
  reconnectObservedRef: { current: boolean }
  reconnectStartedAtRef: { current: number | null }
  roundIndex: number
  sessionId: string | null
  status: string
}

export function useTerminalSmokeDeadline({
  applicationStartedAt,
  onTimeout,
  reconnectRequired,
  hostWakeRequired = false,
  reconnectObservedRef,
  reconnectStartedAtRef,
  roundIndex,
  sessionId,
  status,
}: TerminalSmokeDeadlineOptions): void {
  useEffect(() => {
    const reconnecting = reconnectRequired && reconnectObservedRef.current
    const waiting = reconnecting
      ? status === 'reconnecting' || status === 'connecting'
      : status === 'idle' || status === 'connecting'
    if (!waiting) return
    const roundStartedAt = reconnecting
      ? (reconnectStartedAtRef.current ?? performance.now())
      : roundIndex === 0
        ? applicationStartedAt
        : performance.now()
    const deadlineMs = reconnecting
      ? hostWakeRequired
        ? HOST_WAKE_RECONNECT_DEADLINE_MS
        : RECONNECT_DEADLINE_MS
      : CONNECTION_DEADLINE_MS
    const remainingMs = Math.max(
      0,
      deadlineMs - (performance.now() - roundStartedAt),
    )
    const timer = setTimeout(() => onTimeout(deadlineMs, status), remainingMs)
    return () => clearTimeout(timer)
  }, [
    applicationStartedAt,
    onTimeout,
    reconnectStartedAtRef,
    reconnectRequired,
    hostWakeRequired,
    reconnectObservedRef,
    roundIndex,
    sessionId,
    status,
  ])
}
