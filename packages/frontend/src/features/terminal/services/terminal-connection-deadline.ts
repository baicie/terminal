/** Shared budget for one initial terminal connection attempt. */
export const TERMINAL_CONNECTION_DEADLINE_MS = 10_000

// Leave a small IPC/rendering margin after the backend's deadline expires.
export const TERMINAL_CONNECTION_SAFETY_MARGIN_MS = 100

export function createTerminalConnectionDeadline(
  now = performance.now(),
): number {
  return now + TERMINAL_CONNECTION_DEADLINE_MS
}

export function remainingTerminalConnectionMs(
  deadlineAt: number | undefined,
  now = performance.now(),
): number | undefined {
  if (deadlineAt === undefined) return undefined
  // Rust receives this value as an Option<u64>; flooring also keeps the
  // cross-process timeout inside the absolute deadline when clocks are fractional.
  return Math.floor(
    Math.max(0, deadlineAt - now - TERMINAL_CONNECTION_SAFETY_MARGIN_MS),
  )
}
