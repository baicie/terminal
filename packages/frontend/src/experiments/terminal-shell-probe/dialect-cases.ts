/**
 * The command language the shell interaction probe drives the session with.
 *
 * This module is deliberately a leaf: it declares the case list and the
 * per-dialect case table with no imports at all, so the dialect layer, the
 * result parser and the protocol module can all depend on it without forming
 * an import cycle.
 */
export type ShellProbeCase =
  | 'cat-eof'
  | 'readline-history'
  | 'readline-tab'
  | 'vim-edit'
  | 'nano-edit'
  | 'pty-resize'
  | 'ctrl-c-interrupt'

export type ShellProbeDialect = 'posix' | 'powershell' | 'cmd'

/**
 * The POSIX dialect is the original one and is reused verbatim. The Windows
 * dialects exist because every POSIX case is written in shell syntax -- stty,
 * printf, command substitution, grep, mktemp -d -- that neither PowerShell nor
 * cmd parses. Sending those strings to a Windows shell would report a syntax
 * error as an interaction failure, so each Windows shell gets its own dialect
 * rather than a best-effort translation.
 *
 * The Windows dialects deliberately claim only the cases that exercise the PTY
 * itself: prompt and echo, window-size propagation, interrupt delivery and
 * EOF. The line-editing and editor cases depend on stty, POSIX history and
 * editors a stock Windows runner does not have, so they are left unclaimed
 * there instead of approximated.
 */
export const DIALECT_CASES: Record<ShellProbeDialect, ShellProbeCase[]> = {
  posix: [
    'cat-eof',
    'readline-history',
    'readline-tab',
    'vim-edit',
    'nano-edit',
    'pty-resize',
    'ctrl-c-interrupt',
  ],
  powershell: ['cat-eof', 'pty-resize', 'ctrl-c-interrupt'],
  // cmd.exe has no reliable window-size readout, so only the two cases that
  // need neither a line editor nor a geometry readout are claimed.
  cmd: ['cat-eof', 'ctrl-c-interrupt'],
}

export function dialectSupportsCase(
  dialect: ShellProbeDialect,
  caseName: ShellProbeCase,
): boolean {
  return DIALECT_CASES[dialect].includes(caseName)
}
