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
 */
export function emptySample() {
  return { rssBytes: null, openFds: null, threads: null }
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
  } catch {
    // Leave null: this process may have exited between the lookup and the read.
  }
  try {
    sample.openFds = readdirSync(`/proc/${pid}/fd`).length
  } catch {
    // Avoid a misleading number when the directory cannot be read.
  }
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    const match = /^Threads:\s+(\d+)/m.exec(status)
    if (match) sample.threads = Number(match[1])
  } catch {
    // Leave null.
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

/** macOS: `ps` for rss and threads, `lsof` for descriptors. */
function sampleDarwin(pid) {
  const sample = emptySample()
  const rss = run('ps', ['-o', 'rss=', '-p', String(pid)])
  if (rss !== null) {
    const kilobytes = Number(rss.trim())
    // `ps` reports RSS in KiB on macOS.
    if (Number.isSafeInteger(kilobytes)) sample.rssBytes = kilobytes * 1024
  }
  const threads = run('ps', ['-M', String(pid)])
  if (threads !== null) {
    // One header line plus one line per thread.
    const lines = threads.split('\n').filter(line => line.trim() !== '').length
    if (lines > 1) sample.threads = lines - 1
  }
  const lsof = run('lsof', ['-p', String(pid)])
  if (lsof !== null) {
    // First line is the column header.
    const lines = lsof.split('\n').filter(line => line.trim() !== '').length
    if (lines > 0) sample.openFds = lines - 1
  }
  return sample
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
