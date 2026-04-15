/** Module-level ref for sharing terminal write function between components */
let terminalWriteFn: ((data: string) => void) | null = null

/**
 * Set the terminal write function.
 * Call this from TerminalContainer after terminal is ready.
 */
export function setTerminalWriteFn(fn: (data: string) => void): void {
  terminalWriteFn = fn
}

/**
 * Get the terminal write function.
 * Returns null if terminal is not ready.
 */
export function getTerminalWriteFn(): ((data: string) => void) | null {
  return terminalWriteFn
}

/**
 * Clear the terminal write function (called on unmount).
 */
export function clearTerminalWriteFn(): void {
  terminalWriteFn = null
}
