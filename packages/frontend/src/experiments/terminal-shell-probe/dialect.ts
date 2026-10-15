import {
  DIALECT_CASES,
  dialectSupportsCase,
  type ShellProbeDialect,
} from './dialect-cases'
import {
  createShellProbeHistoryCommand,
  createShellProbeInterruptPassCommand,
  createShellProbeSetupCommand,
  createShellProbeTabStepCommand,
  createShellProbeVimEditSteps,
  createShellProbeVimVerifyCommand,
  createShellProbeNanoEditSteps,
  createShellProbeNanoVerifyCommand,
  createShellProbeInterruptCommand,
  createShellProbeResizeProbeCommand,
  createShellProbeResizeVerdictProbeCommand,
  resizeObservationMarker,
  type ShellProbeCase,
  shellProbeMarkers,
  VIM_PROBE_FILE,
  NANO_PROBE_FILE,
} from './protocol'

/**
 * The command language the probe drives the session with.
 *
 * The POSIX dialect is the original one and is reused verbatim. The Windows
 * dialects exist because every existing case is written in POSIX shell syntax
 * -- stty, printf, command substitution, grep, mktemp -d -- that neither
 * PowerShell nor cmd parses. Sending those strings to a Windows shell would
 * report a syntax error as an interaction failure, so each Windows shell gets
 * its own dialect rather than a best-effort translation.
 *
 * The Windows dialects deliberately claim only the cases that exercise the
 * PTY itself: prompt and echo, window-size propagation, interrupt delivery
 * and EOF. The line-editing and editor cases depend on stty, POSIX history and
 * editors a stock Windows runner does not have, so they are left unclaimed
 * there instead of approximated.
 */
export {
  DIALECT_CASES,
  dialectSupportsCase,
  type ShellProbeDialect,
} from './dialect-cases'

export function casesForDialect(
  dialect: ShellProbeDialect,
): ShellProbeCase[] {
  return [...DIALECT_CASES[dialect]]
}

type Markers = ReturnType<typeof shellProbeMarkers>

function splitMarker(marker: string): [string, string] {
  const splitAt = Math.ceil(marker.length / 2)
  return [marker.slice(0, splitAt), marker.slice(splitAt)]
}

function markerWriter(dialect: 'powershell' | 'cmd') {
  return (marker: string): string => {
    const [head, tail] = splitMarker(marker)
    if (dialect === 'powershell') {
      // A double-quoted PowerShell string expands the CR/LF escape, which
      // puts the marker on its own line without disturbing the prompt.
      return 'Write-Host ("' + '\r\n' + head + tail + '")'
    }
    // set /p writes without a trailing newline, so the surrounding echo.
    // lines supply both the leading and the trailing CRLF.
    return 'echo.& <nul set /p "=' + head + tail + '" & echo.'
  }
}

function powershellSetup(caseName: ShellProbeCase, markers: Markers): string {
  const write = markerWriter('powershell')
  if (caseName === 'cat-eof') {
    // ReadLine consumes exactly the submitted line and echoes nothing itself,
    // which replaces the POSIX stty -echo plus cat pair while still proving
    // that input reaches the PTY and that output comes back.
    return [
      write(markers.ready),
      '$SHELL_PROBE_CAPTURED = [Console]::In.ReadLine()',
      'if ($SHELL_PROBE_CAPTURED -ceq \'cat-eof-probe\') { ' +
        write(markers.pass) +
        ' } else { ' +
        write(markers.fail) +
        ' }',
    ].join('; ')
  }
  if (caseName === 'pty-resize') return write(markers.ready)
  return [write(markers.ready), 'Start-Sleep -Seconds 20'].join('; ')
}

function cmdSetup(caseName: ShellProbeCase, markers: Markers): string {
  const write = markerWriter('cmd')
  if (caseName === 'cat-eof') {
    return [
      write(markers.ready),
      'set /p SHELL_PROBE_CAPTURED=',
      'if "%SHELL_PROBE_CAPTURED%"=="cat-eof-probe" (' +
        write(markers.pass) +
        ') else (' +
        write(markers.fail) +
        ')',
    ].join(' & ')
  }
  // ping is the cmd-native blocking sleep: timeout /t refuses to run when the
  // standard input is redirected, which is exactly the case here.
  return [write(markers.ready), 'ping -n 21 127.0.0.1 >nul'].join(' & ')
}

export function createSetupCommand(
  dialect: ShellProbeDialect,
  nonce: string,
  caseName: ShellProbeCase,
): string {
  if (!dialectSupportsCase(dialect, caseName)) {
    throw new Error(
      'Unsupported shell probe case for ' + dialect + ': ' + caseName,
    )
  }
  if (dialect === 'posix') {
    return createShellProbeSetupCommand(nonce, caseName)
  }
  const markers = shellProbeMarkers(nonce)
  return dialect === 'powershell'
    ? powershellSetup(caseName, markers)
    : cmdSetup(caseName, markers)
}

export function createHistoryCommand(
  dialect: ShellProbeDialect,
  nonce: string,
): string {
  if (dialect === 'posix') return createShellProbeHistoryCommand(nonce)
  throw new Error('Unsupported shell probe history case for ' + dialect)
}

export function createTabStepCommand(
  dialect: ShellProbeDialect,
  nonce: string,
): string {
  if (dialect === 'posix') return createShellProbeTabStepCommand(nonce)
  throw new Error('Unsupported shell probe tab case for ' + dialect)
}

export function createInterruptPassCommand(
  dialect: ShellProbeDialect,
  nonce: string,
): string {
  if (dialect === 'posix') return createShellProbeInterruptPassCommand(nonce)
  return markerWriter(dialect)(shellProbeMarkers(nonce).pass)
}

export function createResizeProbeCommand(
  dialect: ShellProbeDialect,
  nonce: string,
): string {
  if (dialect === 'posix') return createShellProbeResizeProbeCommand(nonce)
  const parts = splitMarker(resizeObservationMarker(nonce))
  const size = '$Host.UI.RawUI.WindowSize'
  return (
    'Write-Host ("' +
    '\r\n' +
    parts[0] +
    parts[1] +
    ':" + ' +
    size +
    '.Height + "_" + ' +
    size +
    '.Width)'
  )
}

export function createResizeVerdictCommand(
  dialect: ShellProbeDialect,
  nonce: string,
  expected: { cols: number; rows: number },
): string {
  if (dialect === 'posix') {
    return createShellProbeResizeVerdictProbeCommand(nonce, expected)
  }
  const write = markerWriter(dialect)
  const markers = shellProbeMarkers(nonce)
  const size = '$Host.UI.RawUI.WindowSize'
  return (
    createResizeProbeCommand(dialect, nonce) +
    '; if (' +
    size +
    '.Height -eq ' +
    expected.rows +
    ' -and ' +
    size +
    '.Width -eq ' +
    expected.cols +
    ') { ' +
    write(markers.step) +
    '; ' +
    write(markers.pass) +
    ' } else { ' +
    write(markers.fail) +
    ' }'
  )
}

export function createVimVerifyCommand(
  dialect: ShellProbeDialect,
  nonce: string,
): string {
  if (dialect !== 'posix') {
    throw new Error('Unsupported shell probe vim case for ' + dialect)
  }
  return createShellProbeVimVerifyCommand(nonce)
}

export function createNanoVerifyCommand(
  dialect: ShellProbeDialect,
  nonce: string,
): string {
  if (dialect !== 'posix') {
    throw new Error('Unsupported shell probe nano case for ' + dialect)
  }
  return createShellProbeNanoVerifyCommand(nonce)
}

export interface DialectInputStep {
  delayMs: number
  data: string
}

/**
 * Gap between the cat-eof payload and the Ctrl+D that closes stdin. Long
 * enough that the PTY has echoed and delivered the text before EOF
 * arrives, short enough to stay well inside the probe deadline.
 */
export const CAT_EOF_DELAY_MS = 250

/**
 * Keystrokes that follow the ready marker, per dialect and case. The POSIX
 * entries are the sequences the automation root already used; the Windows
 * entries drive the same two-phase protocol.
 */
export function readySteps(
  dialect: ShellProbeDialect,
  caseName: ShellProbeCase,
  nonce: string,
): DialectInputStep[] {
  if (caseName === 'cat-eof') {
    // The POSIX setup captures with `captured=$(cat)`, which only returns
    // once stdin reaches EOF, so Ctrl+D has to follow the text. The Windows
    // dialects read exactly one line instead, where a trailing Ctrl+D would
    // be swallowed rather than closing anything, so only POSIX sends it.
    // Without this the POSIX case blocks in cat and the probe can only
    // fail on its deadline.
    return [
      { delayMs: 0, data: 'cat-eof-probe\r' },
      ...(dialect === 'posix'
        ? [{ delayMs: CAT_EOF_DELAY_MS, data: '\u0004' }]
        : []),
    ]
  }
  if (caseName === 'vim-edit') {
    return [
      { delayMs: 0, data: 'vim ' + VIM_PROBE_FILE + '\r' },
      ...createShellProbeVimEditSteps(),
    ]
  }
  if (caseName === 'nano-edit') {
    return [
      { delayMs: 0, data: 'nano ' + NANO_PROBE_FILE + '\r' },
      ...createShellProbeNanoEditSteps(),
    ]
  }
  if (caseName === 'readline-history') {
    return [{ delayMs: 0, data: createHistoryCommand(dialect, nonce) + '\r' }]
  }
  if (caseName === 'readline-tab') {
    return [{ delayMs: 0, data: createTabStepCommand(dialect, nonce) + '\r' }]
  }
  if (caseName === 'ctrl-c-interrupt') {
    return [
      { delayMs: 0, data: createShellProbeInterruptCommand(nonce) + '\r' },
    ]
  }
  // pty-resize is driven by the resize sequence itself, not by input.
  return []
}

/** Keystrokes that follow the step marker, per dialect and case. */
export function stepSteps(
  dialect: ShellProbeDialect,
  caseName: ShellProbeCase,
  nonce: string,
): DialectInputStep[] {
  if (caseName === 'readline-history') {
    return [{ delayMs: 120, data: '\x1b[A\r' }]
  }
  if (caseName === 'vim-edit' || caseName === 'nano-edit') {
    // The editor owns the TTY until it exits, so the shell prints the step
    // marker together with the verdict on the verify command sent afterwards.
    return []
  }
  if (caseName === 'pty-resize') {
    // The final resize probe prints the marker together with the verdict.
    return []
  }
  if (caseName === 'ctrl-c-interrupt') {
    return [
      { delayMs: 200, data: '\x03' },
      {
        delayMs: 900,
        data: createInterruptPassCommand(dialect, nonce) + '\r',
      },
    ]
  }
  return [
    { delayMs: 0, data: 'cat alp' },
    { delayMs: 120, data: '\t' },
    { delayMs: 240, data: '\r' },
  ]
}

/**
 * Delay before the editor verify command. It cannot be triggered by a marker
 * because the editor, not the shell, owns the TTY until it exits.
 */
export function verifyDelayMs(caseName: ShellProbeCase): number {
  return caseName === 'nano-edit' ? 4_500 : 1_800
}

