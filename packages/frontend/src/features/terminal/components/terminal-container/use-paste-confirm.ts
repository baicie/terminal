/**
 * One confirmation for every paste route.
 *
 * The DOM gate (Cmd/Ctrl+V, the native menu, the clipboard addon) and the two
 * context menus all need to ask the same question. Keeping a single pending
 * request here is what stops a paste from being confirmed twice or delivered
 * twice when more than one route reacts to the same keystroke.
 */

import { useCallback, useState } from 'react'
import type { PasteConfirmRequest } from './paste-confirm-dialog'

export interface PasteConfirmController {
  /** The request currently on screen, or null. */
  request: PasteConfirmRequest | null
  /** Resolves true when the user accepts. */
  confirm: (request: PasteConfirmRequest) => Promise<boolean>
  /** Answers the pending request. */
  resolve: (accepted: boolean) => void
}

export function usePasteConfirm(): PasteConfirmController {
  const [request, setRequest] = useState<PasteConfirmRequest | null>(null)
  const [resolver, setResolver] = useState<((accepted: boolean) => void) | null>(
    null,
  )

  const confirm = useCallback(
    (next: PasteConfirmRequest) =>
      new Promise<boolean>(resolve => {
        setRequest(next)
        setResolver(() => resolve)
      }),
    [],
  )

  const resolve = useCallback(
    (accepted: boolean) => {
      resolver?.(accepted)
      setResolver(null)
      setRequest(null)
    },
    [resolver],
  )

  return { request, confirm, resolve }
}
