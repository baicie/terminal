/**
 * The single entry point for pasting into a terminal.
 *
 * Both the context menu and the mobile menu go through this, so the two paths
 * cannot drift into different safety rules. The hook returns a function that
 * either pastes immediately (a plain single line) or asks first (multi-line,
 * control characters, or a large block), and it never edits the text.
 */

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { Terminal as XTerminal } from '@baicie/xterm'
import { assessPaste, pastePreview } from '@/features/terminal/services/paste-policy'

export interface SafePasteOptions {
  /** Asks the user to confirm a risky paste. Resolves true to send it. */
  confirm: (preview: {
    head: string[]
    tail: string[]
    omitted: number
    lineCount: number
    risks: string[]
  }) => Promise<boolean>
  /** Called after the text is sent, so the caller can restore terminal focus. */
  onPasted?: () => void
}

export function useSafePaste(
  term: XTerminal | null,
  options: SafePasteOptions,
) {
  const { t } = useTranslation()
  const { confirm, onPasted } = options

  return useCallback(async () => {
    if (!term) return
    let text: string
    try {
      text = await navigator.clipboard.readText()
    } catch {
      toast.error(t('terminal.pasteEmpty'))
      return
    }
    if (!text) {
      toast.warning(t('terminal.pasteEmpty'))
      return
    }

    const decision = assessPaste(text)
    if (!decision.allowed) {
      const preview = pastePreview(text)
      const accepted = await confirm({
        ...preview,
        lineCount: decision.lineCount,
        risks: decision.risks,
      })
      if (!accepted) return
    }

    // `term.paste` applies bracketed paste when the remote side enabled it, so
    // the text arrives exactly as copied and without an implicit Return.
    term.paste(text)
    onPasted?.()
  }, [term, confirm, onPasted, t])
}
