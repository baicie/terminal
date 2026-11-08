/**
 * Paste policy for the terminal.
 *
 * Pasting into a terminal is not like pasting into an editor: a newline in the
 * clipboard is a Return keypress, so a copied block of text can execute whatever
 * its last line happens to be. The policy classifies the text and decides whether
 * it can go straight through or needs the user's confirmation first.
 *
 * The policy never modifies the text. Adding or stripping a trailing newline,
 * normalising CRLF or escaping control characters would all change what the user
 * asked to send, and the terminal would then run something they never copied.
 */

export type PasteRisk = 'plain' | 'multiline' | 'control' | 'large'

export interface PasteDecision {
  /** True when the text may be written to the terminal without asking. */
  allowed: boolean
  /** Why confirmation is needed; empty when `allowed` is true. */
  risks: PasteRisk[]
  /** Lines that will be sent, for the preview. The full text, never truncated
   *  in a way that hides the last line - that line is the one that executes. */
  lineCount: number
  /** Bytes that will be sent, UTF-8. */
  byteLength: number
}

/** Text longer than this is pasted only after confirmation. */
export const PASTE_CONFIRM_BYTES = 8 * 1024

/**
 * Control characters that change what the shell does with the *rest* of the
 * paste: ESC (turns the remainder into key sequences), Ctrl-C (interrupt),
 * Ctrl-D (EOF), Ctrl-Z (suspend), BEL, and every other C0 control. Checked by
 * code point rather than a regex because a control-character regex is exactly the
 * kind of pattern that is easy to read wrong in review.
 */
function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    // C0 controls, excluding TAB (0x09) and LF (0x0a): a tab is a normal key and
    // a newline is already reported as `multiline`.
    if (code < 0x20 && code !== 0x09 && code !== 0x0a) return true
    if (code === 0x7f) return true
  }
  return false
}

function utf8Length(text: string): number {
  // `TextEncoder` is available in every runtime this app ships on, including the
  // jsdom test environment. The length is only used for the size threshold, so a
  // cheap fallback keeps a missing global from breaking paste entirely.
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length
  }
  return text.length
}

/**
 * Classifies pasted text.
 *
 * A single line without control characters goes straight through: that is the
 * overwhelmingly common case (a path, a hostname, a command the user is about to
 * run and expects to run). Everything else is shown first.
 */
export function assessPaste(text: string): PasteDecision {
  const risks: PasteRisk[] = []
  const byteLength = utf8Length(text)
  const lineCount = text === '' ? 0 : text.split('\n').length

  if (hasControlCharacter(text)) risks.push('control')
  if (lineCount > 1) risks.push('multiline')
  if (byteLength > PASTE_CONFIRM_BYTES) risks.push('large')

  return {
    allowed: risks.length === 0,
    risks,
    lineCount,
    byteLength,
  }
}

/**
 * The preview shown before a risky paste.
 *
 * The tail is always included, because the tail is what the shell runs: showing
 * only the first N lines would hide exactly the part the user needs to see.
 */
export function pastePreview(text: string, maxLines = 40): {
  head: string[]
  tail: string[]
  omitted: number
} {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return { head: lines, tail: [], omitted: 0 }
  const headCount = Math.max(1, Math.floor(maxLines / 2))
  const tailCount = maxLines - headCount
  return {
    head: lines.slice(0, headCount),
    tail: lines.slice(lines.length - tailCount),
    omitted: lines.length - headCount - tailCount,
  }
}
