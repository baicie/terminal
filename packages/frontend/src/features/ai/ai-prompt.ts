/**
 * The shell-command risk flags on a `draft-command` result.
 *
 * ## Where the request payload went
 *
 * This module used to also build the messages (`buildRequestPayload`), and that was
 * the injection defence: a fixed instruction per action, the untrusted text in its
 * own message behind a delimiter, a delimiter chosen to be absent from the content.
 * That defence is a security control, so it moved to the side that actually builds
 * the HTTP body — `src-tauri/src/ai/prompt.rs` — when the request moved to Rust. It
 * is the same algorithm, and the Rust tests pin the wording; leaving a second copy
 * here would let the documented payload drift from the sent one.
 *
 * What stays is the part the dock renders: a generated command carries its risk flags
 * visibly, and that is a UI concern about text we already have. It does not decide
 * anything — it only answers "should the user be warned before copying this".
 */

/**
 * Text a model produced that we refuse to present as a runnable command.
 *
 * `draft-command` output is shown as a draft. This function does not modify it — a
 * silently rewritten command would be worse than a flagged one — it only answers the
 * question the UI needs: "does this warrant a warning before the user copies it".
 */
export function draftRisk(text: string): { risky: boolean; reasons: string[] } {
  const reasons: string[] = []
  const lower = text.toLowerCase()
  if (/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/.test(lower)) {
    reasons.push('deletes files recursively')
  }
  if (/\bsudo\b/.test(lower)) reasons.push('runs with elevated privileges')
  if (/\bcurl[^|]*\|\s*(ba)?sh\b|\bwget[^|]*\|\s*(ba)?sh\b/.test(lower)) {
    reasons.push('pipes downloaded content into a shell')
  }
  if (/\bmkfs\b|\bdd\s+if=/.test(lower)) reasons.push('writes to a device')
  if (/\bchmod\s+777\b/.test(lower)) reasons.push('grants broad permissions')
  if (/>\s*\/etc\//.test(lower)) reasons.push('writes into system configuration')
  return { risky: reasons.length > 0, reasons }
}
