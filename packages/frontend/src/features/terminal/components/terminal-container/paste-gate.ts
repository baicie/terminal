/**
 * The single gate every paste goes through.
 *
 * There are more paste entry points than the two menus this app renders:
 *
 *   - Cmd+V / Ctrl+V is handled by the browser and delivered to xterm directly;
 *   - the native menu's "Paste" does the same;
 *   - Shift+Insert is a paste in most terminals;
 *   - the clipboard addon reads the clipboard itself.
 *
 * Protecting only the context menus left all of those unguarded, so the policy is
 * enforced at the DOM: a capturing `paste` listener on the terminal container
 * decides, and only an approved text reaches the terminal. `preventDefault()` is
 * what stops xterm from also handling the same event, so a confirmed paste is
 * delivered exactly once.
 *
 * The paste is then written with `term.paste()`, which is also where bracketed
 * paste is applied when the remote enabled it. The text is never modified.
 */

import type { Terminal as XTerminal } from '@baicie/xterm'
import { assessPaste, pastePreview } from '@/features/terminal/services/paste-policy'
import type { PasteConfirmRequest } from './paste-confirm-dialog'

export interface PasteGateOptions {
  /** Asks the user to confirm a risky paste; resolves true to deliver it. */
  confirm: (request: PasteConfirmRequest) => Promise<boolean>
  /** Called after a paste actually happened, so focus can be restored. */
  onPasted?: () => void
  /** Notified when the clipboard holds nothing usable. */
  onEmpty?: () => void
}

/**
 * Installs the gate on a terminal container.
 *
 * Returns a disposer. The listener is registered in the capture phase so it runs
 * before xterm's own handler, and it only acts when the paste actually targets
 * this terminal.
 */
export function installPasteGate(
  container: HTMLElement,
  getTerminal: () => XTerminal | null,
  options: PasteGateOptions,
): () => void {
  const onPaste = (event: ClipboardEvent) => {
    const term = getTerminal()
    if (term === null) return
    const text = event.clipboardData?.getData('text/plain') ?? ''
    // Always take the event: xterm's own handler would deliver the same text a
    // second time, and an unconfirmed risky paste would slip through beside ours.
    event.preventDefault()
    event.stopPropagation()

    if (text === '') {
      options.onEmpty?.()
      return
    }

    const decision = assessPaste(text)
    if (decision.allowed) {
      term.paste(text)
      options.onPasted?.()
      return
    }

    const preview = pastePreview(text)
    void options
      .confirm({
        ...preview,
        lineCount: decision.lineCount,
        risks: decision.risks,
      })
      .then(accepted => {
        if (!accepted) return
        term.paste(text)
        options.onPasted?.()
      })
  }

  container.addEventListener('paste', onPaste, true)
  return () => container.removeEventListener('paste', onPaste, true)
}
