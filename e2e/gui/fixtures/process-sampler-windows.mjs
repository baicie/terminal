// DDQ05 — read a Windows process's footprint through PowerShell, with a hard deadline.
//
// ## Why PowerShell and not `wmic`
//
// The previous `findAppPid` used `wmic process get ProcessId,ExecutablePath`. Measured on
// the `windows-latest` runner: `wmic` is not on `PATH`, `run()` returned `null`, and
// `e2e-09` threw "could not find the app process" — a platform capability gap reported as
// a harness defect, on a job that could never have produced a sample. `wmic` is deprecated
// and has been removed from current Windows images; it must not come back.
//
// PowerShell is present on every Windows image and can answer all five metrics in one
// invocation, which matters because this runs once per round.
//
// ## Why one invocation and not five
//
// Each `powershell.exe` start costs 200–400 ms cold on the runner. Five per round × 100
// rounds is up to three minutes of process startup inside the measurement window — the
// same distortion the macOS sampler records for `lsof`. One script, one start, all fields.
//
// ## Why a hard deadline
//
// A hung `Get-Process` (a wedged WMI provider is the usual cause) would otherwise block
// the whole round. Every invocation carries `timeout`, and a timeout is recorded as
// `unavailable` with its own reason rather than as a missing value — "the sampler timed
// out" and "the process had exited" call for different responses.
//
// ## `handleCount` is not `openFds`
//
// Windows counts kernel handles: files, registry keys, events, mutexes, sections. Linux
// counts entries in `/proc/<pid>/fd`. They are different quantities with different typical
// magnitudes, so the Windows number is recorded under its **own** field and never written
// into `openFds`. Filling `openFds` with it to reuse a chart would make a cross-platform
// comparison that the numbers do not support.

/** Fields the Windows sampler can fill, in the order they are reported. */
export const WINDOWS_METRICS = [
  'rssBytes',
  'privateBytes',
  'handleCount',
  'threads',
  'cpuTimeMs',
]

/**
 * The script PowerShell runs.
 *
 * `-NoProfile -NonInteractive` keeps a user profile or a prompt from changing the output;
 * `ConvertTo-Json -Compress` gives one line that is safe to parse. `Get-Process` throws for
 * a pid that does not exist, and `-ErrorAction Stop` turns that into a non-zero exit
 * rather than an empty object — the difference between "no such process" and "a process
 * with no memory".
 */
export function windowsScript(pid) {
  return [
    '$ErrorActionPreference = "Stop"',
    `$p = Get-Process -Id ${pid} -ErrorAction Stop`,
    // `TotalProcessorTime` is a TimeSpan; `.TotalMilliseconds` is the cumulative
    // user+kernel time, the same quantity `ps -o time=` and `/proc/<pid>/stat` give.
    '$o = [ordered]@{',
    '  id = $p.Id',
    '  workingSet = $p.WorkingSet64',
    '  privateBytes = $p.PrivateMemorySize64',
    '  handleCount = $p.HandleCount',
    '  threads = $p.Threads.Count',
    '  cpuMs = [math]::Round($p.TotalProcessorTime.TotalMilliseconds)',
    '  startTime = $p.StartTime.ToUniversalTime().ToString("o")',
    '}',
    '$o | ConvertTo-Json -Compress',
  ].join('\n')
}

/** Wrap a PowerShell command line the way `child_process` expects on Windows. */
export function powershellArgs(script) {
  // `-EncodedCommand` would avoid quoting entirely but takes UTF-16LE base64, which makes
  // a failing invocation unreadable in a log. `-Command` with the script as one argument
  // is what `execFileSync` passes through safely: no shell is involved, so there is
  // nothing to re-quote.
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]
}

/**
 * Parse the one-line JSON `windowsScript` prints.
 *
 * Every field is validated rather than coerced: `Number(undefined)` is `NaN`, and a `NaN`
 * in the series is a number to `typeof` but not to `Number.isFinite`, which is how a
 * missing field becomes an `INSUFFICIENT_DATA` that looks like a sampling gap.
 */
export function parseWindowsSample(stdout) {
  const result = { rss: null, privateBytes: null, handleCount: null, threads: null, cpuMs: null, id: null, startTime: null, reason: null }
  if (typeof stdout !== 'string' || stdout.trim() === '') {
    result.reason = 'powershell printed nothing'
    return result
  }
  let parsed
  try {
    parsed = JSON.parse(stdout.trim().split('\n').pop())
  } catch (error) {
    result.reason = `powershell output was not JSON: ${String(error).slice(0, 80)}`
    return result
  }
  const numeric = value => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  result.id = numeric(parsed.id)
  result.rss = numeric(parsed.workingSet)
  result.privateBytes = numeric(parsed.privateBytes)
  result.handleCount = numeric(parsed.handleCount)
  result.threads = numeric(parsed.threads)
  result.cpuMs = numeric(parsed.cpuMs)
  result.startTime = typeof parsed.startTime === 'string' ? parsed.startTime : null
  if (result.rss === null) result.reason = 'Get-Process returned no WorkingSet64'
  return result
}

/**
 * Run one sample against a pid, or report why it could not.
 *
 * `exec` is injected so the tests can drive every failure shape — a missing binary, a
 * non-zero exit, a timeout, malformed output — without a Windows machine. That is the
 * same reason `resource-curve.mjs` is a pure function: the part that is easy to get wrong
 * has to be testable without the environment it runs in.
 *
 * Returns `null` only when the platform is not Windows, matching `sampleProcess`.
 */
export function sampleWindows(pid, { exec, timeoutMs = 15_000 } = {}) {
  if (typeof exec !== 'function') throw new Error('sampleWindows needs an exec function')
  const script = windowsScript(pid)
  const outcome = exec('powershell.exe', powershellArgs(script), { timeoutMs })
  /*
   * The contract `exec` must honour, kept explicit because it is what the timeout test
   * asserts: `{ ok: true, stdout }`, `{ ok: false, reason, timedOut?, code? }`.
   */
  if (!outcome || outcome.ok !== true) {
    return {
      sample: null,
      reason: outcome?.timedOut === true
        ? `powershell did not answer within ${timeoutMs} ms`
        : (outcome?.reason ?? 'powershell failed'),
      timedOut: outcome?.timedOut === true,
    }
  }
  const parsed = parseWindowsSample(outcome.stdout)
  // A pid mismatch means the OS recycled the number: the values describe a different
  // process and must not enter this series.
  if (parsed.id !== null && parsed.id !== pid) {
    return { sample: null, reason: `powershell reported pid ${parsed.id}, asked for ${pid}`, timedOut: false }
  }
  if (parsed.rss === null) {
    return { sample: null, reason: parsed.reason ?? 'no usable measurement', timedOut: false }
  }
  return {
    sample: {
      rssBytes: parsed.rss,
      // Not `openFds`: see the header. A consumer that wants descriptors on Windows has
      // to ask for handles by name.
      handleCount: parsed.handleCount,
      privateBytes: parsed.privateBytes,
      threads: parsed.threads,
      cpuTimeMs: parsed.cpuMs,
      startTime: parsed.startTime,
      unavailable: {},
    },
    reason: null,
    timedOut: false,
  }
}
