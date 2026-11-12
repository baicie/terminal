import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getReadableTerminalError } from '@/features/terminal/utils/readable-error'

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

/**
 * The pane's error text plus whether the user has dismissed it.
 *
 * One hook rather than two calls at the call site: the readable text and the
 * dismissal key have to agree, and splitting them is how a pane ends up showing
 * the overlay for an error the user already closed.
 */
export function useTerminalErrorSurface(error: string | null): {
  readableError: string | null
  dismissed: boolean
  dismiss: () => void
} {
  const { t } = useTranslation()
  const readableError = error ? getReadableTerminalError(error, t) : null
  const { dismissed, dismiss } = useTerminalErrorDismissal(readableError)
  return { readableError, dismissed, dismiss }
}
