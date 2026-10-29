export function terminalSmokeSessionIsReconnect(
  requiresReconnect: boolean,
  reconnectObserved: boolean,
  reconnectCheckpointSent: boolean,
  initialSessionId: string | null,
  sessionId: string,
): boolean {
  if (reconnectObserved) return true
  return (
    requiresReconnect &&
    reconnectCheckpointSent &&
    initialSessionId !== null &&
    initialSessionId !== sessionId
  )
}
