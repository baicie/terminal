/**
 * Diagnostics for the SFTP dock, behind the GUI E2E build flag.
 *
 * ## Why this exists as a module
 *
 * The dock's failure modes render identically: a listing that failed and a directory
 * that is genuinely empty both say "Empty directory". Reading the DOM cannot tell them
 * apart, and that ambiguity cost several rounds of wrong root causes — an assumed
 * timing race, then an assumed resolve failure, before the trace showed the SSH
 * connection itself was failing.
 *
 * Each entry records what actually happened at one step, so the next reader gets the
 * answer instead of a plausible story. Gated on the same flag as every other probe, so
 * a production bundle never defines it.
 */
const ENABLED = import.meta.env.VITE_TERMINAL_GUI_E2E === '1'

export function traceSftp(message: string): void {
  if (!ENABLED) return
  const scope = globalThis as { __sftpLoadTrace?: string[] }
  scope.__sftpLoadTrace = [...(scope.__sftpLoadTrace ?? []), message]
}

/** The listing path that was asked for, and what the server resolved it to. */
export function traceResolve(path: string, resolved: string | null): void {
  traceSftp(`resolve ${path} -> ${resolved ?? 'null'}`)
}
