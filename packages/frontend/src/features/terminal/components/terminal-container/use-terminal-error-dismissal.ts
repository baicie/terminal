import { useState } from 'react'

/**
 * Whether the user has dismissed the failure overlay for the current error.
 *
 * A dismissal belongs to the error it dismissed. Keying it on the message means a
 * new failure re-opens the overlay instead of inheriting the silence the user
 * asked for about the previous one — the failure overlay is persistent by design,
 * so "stays until dismissed" has to mean "this dismissal, this error".
 */
export function useTerminalErrorDismissal(readableError: string | null): {
  dismissed: boolean
  dismiss: () => void
} {
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  return {
    dismissed: readableError !== null && dismissedError === readableError,
    dismiss: () => setDismissedError(readableError),
  }
}
