// The case list and the dialect table live in a leaf module because the
// dialect layer, the result parser and this module all need them. Declaring
// them here would make the parser depend on this module while this module
// re-exports the parser, which is a cycle.
import type { ShellProbeCase } from './dialect-cases'

export type { ShellProbeCase, ShellProbeDialect } from './dialect-cases'
export type ShellProbeTraceEvent = 'ready' | 'step' | 'pass' | 'fail'

export interface ShellProbeConfig {
  resultPath: string
  caseName: ShellProbeCase
  timeoutMs: number
  /**
   * The command language the runner asked the probe to speak. The acceptance
   * runner decides this from the shell it launched rather than the probe
   * guessing from the user agent, so a mislabelled run fails instead of
   * quietly measuring a different shell than the one requested.
   */
  dialect: 'posix' | 'powershell' | 'cmd'
  /**
   * Present when the probe must drive a real SSH session instead of a local
   * PTY. The backend reuses the smoke matrix's fixture config, so the same
   * interaction cases run over the same loopback sshd the matrix trusts.
   */
  ssh: ShellProbeSshTarget | null
}

export interface ShellProbeSshTarget {
  host: string
  port: number
  username: string
  authMode: 'key' | 'password' | 'agent' | 'cert'
  expectedHostKey: string
  privateKey: string | null
  password: string | null
  certificate: string | null
}

export interface ShellProbeInputEvent {
  kind: 'text' | 'raw'
  bytes: number
  dataHex: string
}

export interface ShellProbeResult {
  caseName: ShellProbeCase
  durationMs: number
  error: string | null
  inputEvents: ShellProbeInputEvent[]
  ok: boolean
  trace: ShellProbeTraceEvent[]
}

const CASE_TRACE: Record<ShellProbeCase, ShellProbeTraceEvent[]> = {
  'cat-eof': ['ready', 'pass'],
  'readline-history': ['ready', 'step', 'pass'],
  'readline-tab': ['ready', 'step', 'pass'],
  'vim-edit': ['ready', 'step', 'pass'],
  'nano-edit': ['ready', 'step', 'pass'],
  'pty-resize': ['ready', 'step', 'pass'],
  'ctrl-c-interrupt': ['ready', 'step', 'pass'],
}
const CASES = Object.keys(CASE_TRACE) as ShellProbeCase[]
const NONCE_PATTERN = /^[A-Za-z0-9_-]{1,48}$/
const MAX_BUFFER_BYTES = 64 * 1024

/** File the vim case edits; the verification command reads the same name. */
export const VIM_PROBE_FILE = 'shell_probe_vim.txt'
/** Text the vim case inserts in insert mode and then verifies on disk. */
export const VIM_PROBE_TEXT = 'vim_probe_edit'
/** File the nano case edits; the verification command reads the same name. */
export const NANO_PROBE_FILE = 'shell_probe_nano.txt'
/** Text the nano case types and then verifies on disk. */
export const NANO_PROBE_TEXT = 'nano_probe_edit'

/**
 * Window sizes the `pty-resize` case drives the terminal through. The last
 * entry doubles as the size the probe asserts on.
 */
export const PTY_RESIZE_SEQUENCE: ReadonlyArray<{
  cols: number
  rows: number
}> = [
  { cols: 132, rows: 43 },
  { cols: 90, rows: 30 },
  { cols: 120, rows: 40 },
  { cols: 97, rows: 31 },
]
/** Seconds the Ctrl+C case sleeps when no interrupt reaches the PTY. */
export const INTERRUPT_PROBE_SLEEP_SECONDS = 20

function isCaseName(value: unknown): value is ShellProbeCase {
  return typeof value === 'string' && CASES.includes(value as ShellProbeCase)
}

function validateNonce(nonce: string): void {
  if (!NONCE_PATTERN.test(nonce)) throw new Error('Invalid shell probe nonce')
}

function markerPrefix(nonce: string): string {
  validateNonce(nonce)
  return `__TERMINAL_SHELL_PROBE_${nonce}_`
}

export function shellProbeMarkers(nonce: string): Record<
  ShellProbeTraceEvent,
  string
> {
  const prefix = markerPrefix(nonce)
  return {
    ready: `${prefix}READY__`,
    step: `${prefix}STEP__`,
    pass: `${prefix}PASS__`,
    fail: `${prefix}FAIL__`,
  }
}

function splitMarker(marker: string): [string, string] {
  const splitAt = Math.ceil(marker.length / 2)
  return [marker.slice(0, splitAt), marker.slice(splitAt)]
}

function markerPrintf(marker: string): string {
  const [prefix, suffix] = splitMarker(marker)
  return `printf '\\r\\n%s%s\\r\\n' '${prefix}' '${suffix}'`
}

function shellProbeBody(
  caseName: ShellProbeCase,
  markers: ReturnType<typeof shellProbeMarkers>,
): string {
  const ready = markerPrintf(markers.ready)
  const pass = markerPrintf(markers.pass)
  const fail = markerPrintf(markers.fail)
  if (caseName === 'cat-eof') {
    return [
      'stty echo',
      ready,
      'stty -echo',
      'captured=$(cat)',
      'stty echo',
      `if [ "$captured" = 'cat-eof-probe' ]; then ${pass}; else ${fail}; fi`,
      'stty sane',
    ].join('; ')
  }
  if (caseName === 'readline-history') {
    return ready
  }
  if (caseName === 'vim-edit') {
    return [
      'SHELL_PROBE_DIR=$(mktemp -d)',
      `printf 'original_probe_line\\r\\n' > "$SHELL_PROBE_DIR/${VIM_PROBE_FILE}"`,
      'cd "$SHELL_PROBE_DIR"',
      ready,
    ].join('; ')
  }
  if (caseName === 'nano-edit') {
    return [
      'SHELL_PROBE_DIR=$(mktemp -d)',
      `printf 'original_probe_line\\r\\n' > "$SHELL_PROBE_DIR/${NANO_PROBE_FILE}"`,
      'cd "$SHELL_PROBE_DIR"',
      ready,
    ].join('; ')
  }
  if (caseName === 'ctrl-c-interrupt') {
    return ['stty echo', ready, 'stty -echo'].join('; ')
  }
  if (caseName === 'pty-resize') {
    // `stty size` only reports the real PTY geometry, so the case needs no
    // scratch state; the ready marker just parks the shell at a prompt.
    return ready
  }
  return [
    "SHELL_PROBE_DIR=$(mktemp -d)",
    `printf '\\r\\n%s%s\\r\\n' '${splitMarker(markers.pass)[0]}' '${splitMarker(markers.pass)[1]}' > "$SHELL_PROBE_DIR/alpha_probe"`,
    'cd "$SHELL_PROBE_DIR"',
    ready,
  ].join('; ')
}

/**
 * Returns an ASCII-only command. Marker strings are deliberately split into
 * two shell arguments so a parser cannot observe a pass marker before the
 * corresponding interaction happens.
 */
export function createShellProbeSetupCommand(
  nonce: string,
  caseName: ShellProbeCase,
): string {
  if (!isCaseName(caseName)) throw new Error('Unsupported shell probe case')
  return shellProbeBody(caseName, shellProbeMarkers(nonce))
}

export function expectedShellProbeTrace(
  caseName: ShellProbeCase,
): ShellProbeTraceEvent[] {
  if (!isCaseName(caseName)) throw new Error('Unsupported shell probe case')
  return [...CASE_TRACE[caseName]]
}

/** First readline command; its second execution via Up emits the pass marker. */
export function createShellProbeHistoryCommand(nonce: string): string {
  const markers = shellProbeMarkers(nonce)
  const step = markerPrintf(markers.step)
  const pass = markerPrintf(markers.pass)
  return `if [ "${'${SHELL_PROBE_HISTORY_SEEN:-0}'}" -eq 0 ]; then SHELL_PROBE_HISTORY_SEEN=1; ${step}; else ${pass}; fi`
}

/** Emits the step marker before the subsequent readline completion input. */
export function createShellProbeTabStepCommand(nonce: string): string {
  return markerPrintf(shellProbeMarkers(nonce).step)
}

/**
 * Ctrl+C case: prints the step marker, then blocks in `sleep`. If the
 * interrupt never reaches the PTY the probe fails on its own deadline.
 *
 * There is deliberately no trailing fail marker. The shells disagree about
 * what a foreground SIGINT does to the rest of a `;` list: bash kills the
 * `sleep` and then runs the next command in the list, while zsh abandons the
 * whole list. Any verdict expressed that way would measure each shell's list
 * semantics instead of the terminal's interrupt delivery. A swallowed
 * interrupt instead keeps `sleep` blocking, leaves the pass command buffered
 * for it, and fails the probe on its deadline.
 */
export function createShellProbeInterruptCommand(nonce: string): string {
  const markers = shellProbeMarkers(nonce)
  return [markerPrintf(markers.step), `sleep ${INTERRUPT_PROBE_SLEEP_SECONDS}`].join(
    '; ',
  )
}

/**
 * Typed only after Ctrl+C was expected to return the shell to its prompt. If
 * the interrupt was swallowed this text is still buffered for `sleep`, the
 * pass marker is never printed and the probe fails on its deadline instead.
 */
export function createShellProbeInterruptPassCommand(nonce: string): string {
  return markerPrintf(shellProbeMarkers(nonce).pass)
}

/**
 * Vim case verification. The editor owns the TTY while it runs, so the shell
 * cannot print the step marker during the edit; it is emitted here, together
 * with the pass/fail verdict on what vim actually wrote to disk.
 */
export function createShellProbeVimVerifyCommand(nonce: string): string {
  const markers = shellProbeMarkers(nonce)
  const step = markerPrintf(markers.step)
  const pass = markerPrintf(markers.pass)
  const fail = markerPrintf(markers.fail)
  return `if grep -q '${VIM_PROBE_TEXT}' '${VIM_PROBE_FILE}'; then ${step}; ${pass}; else ${fail}; fi`
}

/**
 * Nano case verification. nano owns the TTY while it runs, so the shell cannot
 * print the step marker during the edit; it is emitted here together with the
 * pass/fail verdict on what nano actually wrote to disk.
 */
export function createShellProbeNanoVerifyCommand(nonce: string): string {
  const markers = shellProbeMarkers(nonce)
  const step = markerPrintf(markers.step)
  const pass = markerPrintf(markers.pass)
  const fail = markerPrintf(markers.fail)
  return `if grep -q '${NANO_PROBE_TEXT}' '${NANO_PROBE_FILE}'; then ${step}; ${pass}; else ${fail}; fi`
}

export interface ShellProbeInputStep {
  /** Milliseconds after the triggering marker before the bytes are typed. */
  delayMs: number
  data: string
}

/**
 * Keystrokes that drive the vim case, in order. They are triggered by the
 * `ready` marker rather than by `step`: vim owns the TTY while it runs, so the
 * shell cannot print `step` until vim has exited. Waiting for `step` before
 * sending any of these keys would deadlock the case until its deadline.
 */
export function createShellProbeVimEditSteps(): ShellProbeInputStep[] {
  return [
    // Linux hosted runners can take longer to paint Vim's alternate screen
    // under Xvfb. Give the editor a full second before entering insert mode;
    // the probe still completes well inside its 20-second deadline.
    { delayMs: 1_000, data: 'i' },
    { delayMs: 1_300, data: VIM_PROBE_TEXT },
    { delayMs: 1_600, data: '\x1b' },
    { delayMs: 1_900, data: ':wq\r' },
  ]
}

/**
 * Keystrokes that drive the nano case, in order. Like the vim case these are
 * triggered by `ready`, because nano owns the TTY until it exits and the shell
 * therefore cannot print `step` before the edit is over.
 *
 * `\x0f` is Ctrl+O (Write Out), which makes nano ask for a filename; Return
 * accepts the existing name and nano writes the buffer. Whether nano then
 * exits on its own depends on the build, so `\x18` (Ctrl+X) closes it either
 * way. Without the write-out the edit would be discarded and the on-disk
 * check would fail, so this is what makes the check meaningful.
 */
export function createShellProbeNanoEditSteps(): ShellProbeInputStep[] {
  return [
    // nano paints its own screen before it starts reading the file, so the
    // first keystroke has to wait for the editor to settle rather than for the
    // shell prompt. Sending early types into the still-rendering screen and
    // leaves the buffer unmodified.
    { delayMs: 1_200, data: NANO_PROBE_TEXT },
    { delayMs: 1_500, data: '\x0f' },
    { delayMs: 1_800, data: '\r' },
    { delayMs: 2_200, data: '\x18' },
  ]
}

/**
 * Command that reports the PTY's current size. The frontend issues one of
 * these after every resize and checks the answer against what it just asked
 * for, so a terminal that silently drops a resize fails on that step instead
 * of quietly passing on the last one.
 *
 * The observation deliberately uses its own prefix rather than a trace
 * marker: the parser advances its trace on step/pass/fail, so reusing a trace
 * marker here would consume the step before the resize sequence finished.
 */
export function createShellProbeResizeProbeCommand(nonce: string): string {
  const [head, tail] = splitMarker(resizeObservationMarker(nonce))
  return (
    `set -- $(stty size); printf '\\r\\n%s%s:%s_%s\\r\\n' '${head}' '${tail}' "$1" "$2"`
  )
}

/**
 * Command that reports the PTY size and, on the last step, also prints the
 * step/pass (or fail) verdict. The intermediate probes stay observation-only so
 * the frontend can reject a terminal that drops one resize but happens to end
 * on the right size.
 */
export function createShellProbeResizeVerdictProbeCommand(
  nonce: string,
  expected: { cols: number; rows: number },
): string {
  const markers = shellProbeMarkers(nonce)
  const step = markerPrintf(markers.step)
  const pass = markerPrintf(markers.pass)
  const fail = markerPrintf(markers.fail)
  const [head, tail] = splitMarker(resizeObservationMarker(nonce))
  return (
    `set -- $(stty size); printf '\\r\\n%s%s:%s_%s\\r\\n' '${head}' '${tail}' "$1" "$2"; ` +
    `if [ "$1" = '${expected.rows}' ] && [ "$2" = '${expected.cols}' ]; ` +
    `then ${step}; ${pass}; else ${fail}; fi`
  )
}

/**
 * Parses the observation a resize probe prints, e.g. `..._SIZE__:31_97`.
 * Returns the observed `rows` and `cols`, or null when the line is not one.
 */
export function parseResizeObservation(
  line: string,
  nonce: string,
): { rows: number; cols: number } | null {
  const marker = resizeObservationMarker(nonce)
  const match = line.indexOf(marker)
  if (match < 0) return null
  // The probe prints `<marker>:<rows>_<cols>`; drop the separator before
  // parsing or the digits never match the leading group.
  const value = line.slice(match + marker.length).replace(/^:/, '')
  const parsed = /^(\d+)_(\d+)/.exec(value.trim())
  if (!parsed) return null
  const rows = Number(parsed[1])
  const cols = Number(parsed[2])
  return Number.isSafeInteger(rows) && Number.isSafeInteger(cols)
    ? { rows, cols }
    : null
}

export function resizeObservationMarker(nonce: string): string {
  validateNonce(nonce)
  return `${markerPrefix(nonce)}SIZE__`
}

export class ShellProbeParser {
  private buffer = ''
  private traceIndex = 0
  private finished = false

  constructor(
    private readonly nonce: string,
    private readonly caseName: ShellProbeCase,
  ) {
    validateNonce(nonce)
    if (!isCaseName(caseName)) throw new Error('Unsupported shell probe case')
  }

  push(chunk: string): Array<{ kind: ShellProbeTraceEvent }> {
    if (!chunk || this.finished) return []
    this.buffer += chunk
    if (new TextEncoder().encode(this.buffer).byteLength > MAX_BUFFER_BYTES) {
      throw new Error('Shell probe output exceeded its safety limit')
    }
    const markers = shellProbeMarkers(this.nonce)
    const events: Array<{ kind: ShellProbeTraceEvent }> = []
    while (this.traceIndex < expectedShellProbeTrace(this.caseName).length) {
      const failIndex = this.buffer.indexOf(markers.fail)
      const expected = expectedShellProbeTrace(this.caseName)[this.traceIndex]
      const marker = markers[expected]
      const markerIndex = this.buffer.indexOf(marker)
      if (failIndex >= 0 && (markerIndex < 0 || failIndex <= markerIndex)) {
        this.buffer = this.buffer.slice(failIndex + markers.fail.length)
        this.finished = true
        events.push({ kind: 'fail' })
        return events
      }
      if (markerIndex < 0) {
        this.retainMarkerSuffix(marker)
        return events
      }
      this.buffer = this.buffer.slice(markerIndex + marker.length)
      this.traceIndex += 1
      events.push({ kind: expected })
      if (expected === 'pass') this.finished = true
    }
    return events
  }

  private retainMarkerSuffix(marker: string): void {
    const maxSuffix = Math.min(marker.length - 1, this.buffer.length)
    for (let length = maxSuffix; length > 0; length -= 1) {
      if (this.buffer.endsWith(marker.slice(0, length))) {
        this.buffer = this.buffer.slice(-length)
        return
      }
    }
    this.buffer = ''
  }
}

export {
  loadShellProbeConfig,
  parseShellProbeConfig,
  parseShellProbeResult,
  publishShellProbeResult,
} from './result'
