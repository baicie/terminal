// RC18 — sample a running app's footprint from **outside** it.
//
// ## Why the sampler lives out here
//
// The task asks for RSS, CPU, descriptors and threads across 100 rounds of real GUI work.
// Every one of those can also be counted inside the app, and every such counter is a
// measurement the thing being measured produces: an instrumentation bug changes the number,
// a crash destroys the series, and a counter that stops being updated reads as a flatline.
// `ps` and `lsof` describe the process the way the operating system does. That is the only
// view that cannot agree with a broken app by construction.
//
// ## What each platform actually provides
//
// macOS has no `/proc`. `ps -o rss=` gives kilobytes; `ps -M <pid>` prints one line per
// thread, so the line count is the thread count; `lsof -p <pid>` enumerates descriptors and
// costs ~20 ms, which is fine at one sample per round.
//
// Linux answers all four from `/proc/<pid>` directly, and is what this file prefers when it
// is available — reading a file beats spawning two processes 100 times.
//
// Measured locally: `ps -o thcount` and `-o nlwp` do **not** exist on macOS. That is why
// threads are counted by the `-M` line count rather than a column.

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'

/**
 * One sample. Every field is `null` when this platform could not answer it — never zero.
 *
 * A zero would enter the series as a real measurement and make an unmeasured platform look
 * like a perfectly flat line, which is the failure mode `session/process_metrics.rs` also
 * refuses.
 *
 * `unavailable` is where the **reason** goes. Without it a reader cannot tell "the process
 * had exited" apart from "this platform has no such counter" apart from "the command
 * timed out", and those three call for three different responses. `resource-series.mjs`
 * counts these into the artifact so the reason survives into the evidence file.
 *
 * `cpuTimeMs` is **cumulative** user+system CPU time since process start, not utilisation
 * over the sampling interval. The distinction matters: a cumulative series must be
 * monotonic and its *slope* is the interesting part, while a utilisation sample is already
 * a rate and averaging rates is not the same as averaging slopes. Recorded as cumulative
 * because that is what every platform reports natively and because differencing two
 * cumulative readings is exact, while integrating a rate is not.
 */
export function emptySample() {
  return { rssBytes: null, openFds: null, threads: null, cpuTimeMs: null, unavailable: {} }
}

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

/** Linux: everything comes from `/proc/<pid>`, one read each. */
function sampleLinux(pid) {
  const sample = emptySample()
  try {
    const statm = readFileSync(`/proc/${pid}/statm`, 'utf8').trim().split(/\s+/)
    // Fields are in pages; the second is resident, and the page size is asked of the OS
    // rather than assumed, because 4 KiB is wrong on some architectures.
    const pages = Number(statm[1])
    if (Number.isSafeInteger(pages)) sample.rssBytes = pages * PAGE_SIZE
    else sample.unavailable.rssBytes = '/proc/<pid>/statm had no resident field'
  } catch {
    // Leave null: this process may have exited between the lookup and the read.
    sample.unavailable.rssBytes = 'could not read /proc/<pid>/statm (process gone?)'
  }
  try {
    sample.openFds = readdirSync(`/proc/${pid}/fd`).length
  } catch {
    // Avoid a misleading number when the directory cannot be read.
    sample.unavailable.openFds = 'could not read /proc/<pid>/fd'
  }
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    const match = /^Threads:\s+(\d+)/m.exec(status)
    if (match) sample.threads = Number(match[1])
    else sample.unavailable.threads = '/proc/<pid>/status had no Threads line'
  } catch {
    // Leave null.
    sample.unavailable.threads = 'could not read /proc/<pid>/status'
  }
  try {
    /*
     * `/proc/<pid>/stat` fields 14 and 15 are utime and stime in clock ticks.
     *
     * Read separately from `statm` because the field is not in `statm`, and split from the
     * right of the closing parenthesis so a process name containing spaces (which `stat`
     * does not escape) cannot shift the index.
     */
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const close = stat.lastIndexOf(')')
    if (close > 0) {
      const fields = stat.slice(close + 2).trim().split(/\s+/)
      // After the comm field, index 0 is `state` (field 3), so utime (14) is index 11.
      const utime = Number(fields[11])
      const stime = Number(fields[12])
      if (Number.isFinite(utime) && Number.isFinite(stime)) {
        sample.cpuTimeMs = ((utime + stime) * 1000) / CLOCK_TICKS
      } else {
        sample.unavailable.cpuTimeMs = '/proc/<pid>/stat had no usable utime/stime'
      }
    } else {
      sample.unavailable.cpuTimeMs = '/proc/<pid>/stat could not be parsed'
    }
  } catch {
    sample.unavailable.cpuTimeMs = 'could not read /proc/<pid>/stat'
  }
  return sample
}

let PAGE_SIZE = 4096
try {
  // `getconf PAGESIZE` is the portable answer on both Linux and macOS.
  const raw = run('getconf', ['PAGESIZE'])
  const parsed = raw === null ? NaN : Number(raw.trim())
  if (Number.isSafeInteger(parsed) && parsed > 0) PAGE_SIZE = parsed
} catch {
  // Keep the conservative default; a wrong page size only scales rssBytes.
}

/**
 * Clock ticks per second, for converting `/proc/<pid>/stat`'s utime/stime to milliseconds.
 *
 * `getconf CLK_TCK` is the portable way to ask; 100 is the Linux default on every
 * mainstream architecture. A wrong value scales `cpuTimeMs` by a constant, which would
 * still be usable as a *shape* but not as a number, so the value is recorded in the
 * capabilities the artifact carries rather than left implicit.
 */
let CLOCK_TICKS = 100
try {
  const raw = run('getconf', ['CLK_TCK'])
  const parsed = raw === null ? NaN : Number(raw.trim())
  if (Number.isSafeInteger(parsed) && parsed > 0) CLOCK_TICKS = parsed
} catch {
  // Keep the Linux default.
}

/**
 * What this platform can and cannot measure, so an artifact can say it once.
 *
 * ## Why a capability object and not just nulls
 *
 * `supported: false` is a statement about the platform; `supported: true` with a metric
 * missing is a statement about **this run**. Collapsing the two is how a sampling failure
 * gets filed as "Windows cannot do this" and never gets looked at again — and the mirror
 * error, calling a platform limit a defect, blocks a platform for something it was never
 * asked to provide.
 *
 * `processIdentityMethod` is recorded because the way a pid was found is part of the
 * measurement's credibility: a pid taken from the harness that spawned the app is a fact,
 * while a pid found by name-matching is a guess that can land on the wrong process.
 */
export function platformCapabilities(platform = process.platform) {
  if (platform === 'linux') {
    return {
      supported: true,
      availableMetrics: ['rssBytes', 'openFds', 'threads', 'cpuTimeMs'],
      processIdentityMethod: 'ps argv[0] match',
      // `/proc/<pid>/fd` is the process's own descriptor table, so this is a true count
      // of open descriptors rather than a count of `lsof` output lines.
      openDescriptorsMeaning: 'entries in /proc/<pid>/fd',
      unsupportedReason: null,
    }
  }
  if (platform === 'darwin') {
    return {
      supported: true,
      availableMetrics: ['rssBytes', 'openFds', 'threads', 'cpuTimeMs'],
      processIdentityMethod: 'ps argv[0] match',
      /*
       * `lsof -p <pid>` prints one line per *open file*, and the first column mixes real
       * numeric descriptors with synthetic entries: `txt` (the executable), `cwd`, `rtd`,
       * and on recent macOS also `mem` regions. So the row count is **not** the descriptor
       * count, and it is not claimed to be. It is a consistent proxy that moves when
       * descriptors leak, recorded under its own meaning so nobody compares it with
       * Linux's `/proc/<pid>/fd` count as if the two were the same number.
       */
      openDescriptorsMeaning: 'lsof output lines minus header (includes txt/cwd/mem rows)',
      unsupportedReason: null,
    }
  }
  if (platform === 'win32') {
    return {
      supported: false,
      availableMetrics: [],
      processIdentityMethod: null,
      openDescriptorsMeaning: null,
      unsupportedReason:
        'no sampler is implemented for win32 yet; a zero would read as a measured flat ' +
        'line, so the run is recorded as NOT_RUN instead (DDQ05)',
    }
  }
  return {
    supported: false,
    availableMetrics: [],
    processIdentityMethod: null,
    openDescriptorsMeaning: null,
    unsupportedReason: `no sampler is implemented for ${platform}`,
  }
}

/**
 * Where a measurement's boundary is.
 *
 * A single Tauri process's RSS is **not** the application's memory: WebKit's WebContent
 * and GPU helpers on macOS, WebView2's renderer on Windows, and the WebKitGTK web process
 * on Linux all hold memory the user experiences as "the app". Reporting a main-process
 * curve and calling it the application's footprint overstates the claim.
 *
 * Only the first is implemented, and only the first is claimed. Widening it requires
 * proving process ownership (same bundle, same session, spawned by the app), and getting
 * that wrong attributes other applications' WebView memory to this one.
 */
export const MEASUREMENT_SCOPE = {
  MAIN_PROCESS:
    'the single process whose argv[0] is the app binary; excludes WebView renderer/GPU helpers',
  OWNED_PROCESS_TREE: 'not measured — requires proving ownership of each descendant',
  WEBVIEW_PROCESS_GROUP: 'not measured — shared WebView processes cannot be attributed safely',
}

/** macOS: `ps` for rss, threads and cpu time; `lsof` for descriptors. */
function sampleDarwin(pid) {
  const sample = emptySample()
  const rss = run('ps', ['-o', 'rss=', '-p', String(pid)])
  if (rss !== null) {
    const kilobytes = Number(rss.trim())
    // `ps` reports RSS in KiB on macOS.
    if (Number.isSafeInteger(kilobytes)) sample.rssBytes = kilobytes * 1024
    else sample.unavailable.rssBytes = 'ps printed no numeric rss'
  } else {
    sample.unavailable.rssBytes = 'ps -o rss= failed (process gone?)'
  }
  const threads = run('ps', ['-M', String(pid)])
  if (threads !== null) {
    // One header line plus one line per thread.
    const lines = threads.split('\n').filter(line => line.trim() !== '').length
    if (lines > 1) sample.threads = lines - 1
    else sample.unavailable.threads = 'ps -M printed no thread rows'
  } else {
    sample.unavailable.threads = 'ps -M failed'
  }
  const lsof = run('lsof', ['-p', String(pid)])
  if (lsof !== null) {
    // First line is the column header.
    const lines = lsof.split('\n').filter(line => line.trim() !== '').length
    if (lines > 0) sample.openFds = lines - 1
    else sample.unavailable.openFds = 'lsof printed no rows'
  } else {
    sample.unavailable.openFds = 'lsof failed or is not installed'
  }
  /*
   * Cumulative CPU time, the same quantity Linux reads from `/proc/<pid>/stat`.
   *
   * `ps -o time=` prints `[[dd-]hh:]mm:ss.cc`, so the parser has to accept every one of
   * those shapes instead of assuming `mm:ss`. Measured on this host: a long-lived process
   * reports `9:51.49` and a very long-lived one grows a days field, so a two-field parser
   * would start returning null on exactly the runs that matter most.
   */
  const cpu = run('ps', ['-o', 'time=', '-p', String(pid)])
  if (cpu !== null) {
    const parsed = parsePsCpuTime(cpu.trim())
    if (parsed !== null) sample.cpuTimeMs = parsed
    else sample.unavailable.cpuTimeMs = `ps printed an unparsable time: ${cpu.trim()}`
  } else {
    sample.unavailable.cpuTimeMs = 'ps -o time= failed'
  }
  return sample
}

/**
 * Parse BSD `ps -o time=` output into milliseconds.
 *
 * Shapes: `ss.cc`, `mm:ss.cc`, `hh:mm:ss.cc`, `dd-hh:mm:ss.cc`. Returns `null` rather
 * than a guess when the string does not match, because a wrong CPU time is worse than a
 * missing one — a missing sample is visible in the artifact, a wrong one is not.
 */
export function parsePsCpuTime(text) {
  if (typeof text !== 'string') return null
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text.trim())
  if (!match) return null
  const days = Number(match[1] ?? 0)
  const hours = Number(match[2] ?? 0)
  const minutes = Number(match[3])
  const seconds = Number(match[4])
  if (![days, hours, minutes, seconds].every(Number.isFinite)) return null
  return ((days * 86400 + hours * 3600 + minutes * 60 + seconds) * 1000) | 0
}

/**
 * Whether this platform can be sampled at all.
 *
 * Exists so a caller can ask **before** it does anything else that only makes sense on a
 * samplable platform. Measured on the Windows GUI job: `e2e-09` looked up the app's pid
 * first, `findAppPid` answered `null` there (that platform's lookup is `wmic`, which this
 * runner does not provide), and the case threw "could not find the app process" — a
 * capability gap reported as a harness defect, on a job that could never have produced a
 * sample. The order of the two questions is the whole point.
 */
export function canSample(platform = process.platform) {
  return platformCapabilities(platform).supported
}

/**
 * Sample one process, or `null` when the platform cannot.
 *
 * `null` vs a sample of nulls: a caller that cannot measure at all should say so once,
 * rather than run 100 rounds of nulls and report a flat curve.
 */
export function sampleProcess(pid, platform = process.platform) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`sampleProcess needs a positive pid, got ${pid}`)
  }
  if (platform === 'linux') return sampleLinux(pid)
  if (platform === 'darwin') return sampleDarwin(pid)
  return null
}

/**
 * Find the app's pid by the binary path the harness launched.
 *
 * ## Why the command is matched as the *first* token
 *
 * A substring search over full command lines is self-matching: measured, `findAppPid(
 * '/no/such/binary')` returned a pid because the `ps` output included the shell running
 * the query, whose own command line contained that string. A sampler that locks onto an
 * arbitrary process reports *something* for all 100 rounds and never fails — the worst
 * shape a measurement can take.
 *
 * The launched binary is `argv[0]`, so the path has to be the first token after the pid.
 * Arguments that happen to mention the path (a `--config` under the app's directory) then
 * cannot match.
 */
export function findAppPid(executablePath, platform = process.platform) {
  if (typeof executablePath !== 'string' || executablePath === '') return null
  if (platform === 'win32') {
    const output = run('wmic', ['process', 'get', 'ProcessId,ExecutablePath', '/format:csv'])
    if (output === null) return null
    for (const line of output.split('\n')) {
      const match = /,(?<path>[^,]+),(\d+)\s*$/.exec(line.trim())
      if (match && match.groups?.path === executablePath) return Number(match[2])
    }
    return null
  }
  const output = run('ps', ['-eo', 'pid=,args='])
  if (output === null) return null
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\S+)/.exec(line)
    if (match && match[2] === executablePath) return Number(match[1])
  }
  return null
}
