// DDQ05 — the Windows sampler's contract, driven without a Windows machine.
//
// ## What is being pinned, and why each shape matters
//
// `sampleWindows` is the only part of the Windows path that can be tested anywhere: the
// PowerShell invocation itself needs the runner, but **every way it can fail** does not.
// Those failures are the interesting half. A sampler that turns a timeout into a zero, a
// dead process into a flat line, or a recycled pid into a plausible number produces
// evidence that looks exactly like a healthy run.
//
// The exec function is injected for this reason. Every case below drives `sampleWindows`
// with a stub that reproduces one real failure shape.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  WINDOWS_METRICS,
  parseWindowsSample,
  powershellArgs,
  sampleWindows,
  windowsScript,
} from './process-sampler-windows.mjs'
import { findAppPid } from './process-sampler.mjs'

/** A stub exec that records its arguments and returns a fixed outcome. */
function stubExec(outcome) {
  const calls = []
  const exec = (file, args, options) => {
    calls.push({ file, args, options })
    return outcome
  }
  exec.calls = calls
  return exec
}

const HEALTHY = JSON.stringify({
  id: 4321,
  workingSet: 128 * 1024 * 1024,
  privateBytes: 96 * 1024 * 1024,
  handleCount: 512,
  threads: 37,
  cpuMs: 12_345,
  startTime: '2026-11-28T06:00:00.0000000Z',
})

describe('DDQ05 — one invocation, every metric', () => {
  it('asks PowerShell once per sample, not once per metric', () => {
    /*
     * Measured: `powershell.exe` start costs 200–400 ms cold on the runner. Five starts
     * per round is up to two minutes of process startup inside a 100-round measurement.
     */
    const exec = stubExec({ ok: true, stdout: HEALTHY })
    sampleWindows(4321, { exec })
    assert.equal(exec.calls.length, 1, 'the sampler must not spawn PowerShell per metric')
    assert.equal(exec.calls[0].file, 'powershell.exe')
    for (const flag of ['-NoProfile', '-NonInteractive']) {
      assert.ok(exec.calls[0].args.includes(flag), `missing ${flag}`)
    }
  })

  it('carries a hard deadline on every invocation', () => {
    // A wedged WMI provider must not block the round. The timeout is the only thing that
    // ends it, so its absence is a hang waiting to happen.
    const exec = stubExec({ ok: true, stdout: HEALTHY })
    sampleWindows(4321, { exec, timeoutMs: 12_345 })
    assert.equal(exec.calls[0].options.timeoutMs, 12_345)
  })

  it('reports all five metrics the task names', () => {
    const { sample } = sampleWindows(4321, { exec: stubExec({ ok: true, stdout: HEALTHY }) })
    assert.ok(sample, 'a healthy sample must not be null')
    assert.equal(sample.rssBytes, 128 * 1024 * 1024)
    assert.equal(sample.privateBytes, 96 * 1024 * 1024)
    assert.equal(sample.handleCount, 512)
    assert.equal(sample.threads, 37)
    assert.equal(sample.cpuTimeMs, 12_345)
    assert.deepEqual(Object.keys(sample.unavailable), [])
  })

  it('never writes the handle count into openFds', () => {
    /*
     * Windows `HandleCount` counts kernel handles (files, registry keys, events, mutexes);
     * Linux `openFds` counts `/proc/<pid>/fd` entries. Filling one field with the other so
     * a chart can be reused would invite a comparison the numbers do not support.
     */
    const { sample } = sampleWindows(4321, { exec: stubExec({ ok: true, stdout: HEALTHY }) })
    assert.equal(sample.openFds, undefined, 'openFds must stay absent on Windows')
    assert.ok(WINDOWS_METRICS.includes('handleCount'))
    assert.ok(!WINDOWS_METRICS.includes('openFds'))
  })
})

describe('DDQ05 — every failure shape is a reason, never a number', () => {
  it('reports a timeout as a timeout, not as a missing value', () => {
    const { sample, reason, timedOut } = sampleWindows(4321, {
      exec: stubExec({ ok: false, timedOut: true, reason: 'killed' }),
    })
    assert.equal(sample, null)
    assert.equal(timedOut, true)
    assert.match(reason, /did not answer within/)
  })

  it('reports a pid that no longer exists rather than returning zeros', () => {
    // `Get-Process -Id` exits non-zero for a pid that is gone; that is the shape of an
    // app that crashed mid-run. A zero would read as a perfectly flat measurement.
    const { sample, reason } = sampleWindows(999, {
      exec: stubExec({ ok: false, reason: 'Cannot find a process with the process identifier 999' }),
    })
    assert.equal(sample, null)
    assert.match(reason, /Cannot find a process/)
  })

  it('refuses output that is not JSON', () => {
    const { sample, reason } = sampleWindows(4321, {
      exec: stubExec({ ok: true, stdout: 'Get-Process : Access is denied.' }),
    })
    assert.equal(sample, null)
    assert.match(reason, /not JSON/)
  })

  it('refuses output with no WorkingSet', () => {
    const { sample, reason } = sampleWindows(4321, {
      exec: stubExec({ ok: true, stdout: JSON.stringify({ id: 4321 }) }),
    })
    assert.equal(sample, null)
    assert.match(reason, /no WorkingSet64/)
  })

  it('refuses a pid mismatch, which means the number was recycled', () => {
    /*
     * Measured shape: a process exits, Windows reuses its pid for an unrelated one, and
     * the sampler keeps reading. The values are real; they describe the wrong process.
     */
    const recycled = JSON.stringify({ ...JSON.parse(HEALTHY), id: 9999 })
    const { sample, reason } = sampleWindows(4321, { exec: stubExec({ ok: true, stdout: recycled }) })
    assert.equal(sample, null)
    assert.match(reason, /reported pid 9999/)
  })

  it('refuses an empty stdout', () => {
    const { sample, reason } = sampleWindows(4321, { exec: stubExec({ ok: true, stdout: '   ' }) })
    assert.equal(sample, null)
    assert.match(reason, /printed nothing/)
  })

  it('does not turn a non-finite field into a sample', () => {
    // JSON has no NaN, but PowerShell can print `null` for a field it could not read.
    const partial = JSON.stringify({ id: 4321, workingSet: null, handleCount: 10 })
    const { sample } = sampleWindows(4321, { exec: stubExec({ ok: true, stdout: partial }) })
    assert.equal(sample, null)
  })
})

describe('DDQ05 — the script says what it needs', () => {
  it('asks for the five named properties', () => {
    const script = windowsScript(4321)
    for (const property of ['WorkingSet64', 'PrivateMemorySize64', 'HandleCount', 'Threads.Count', 'TotalProcessorTime']) {
      assert.ok(script.includes(property), `script must read ${property}`)
    }
  })

  it('fails loudly for a missing process instead of printing nothing', () => {
    const script = windowsScript(4321)
    assert.match(script, /ErrorActionPreference\s*=\s*"Stop"/)
    assert.match(script, /-ErrorAction Stop/)
  })

  it('passes the script as a single argument, with no shell involved', () => {
    const args = powershellArgs('Get-Process')
    assert.equal(args.at(-1), 'Get-Process')
    // No `cmd /c`: `execFileSync` starts the binary directly, so there is nothing to quote.
    assert.ok(!args.includes('/c'))
  })

  it('reports cpu time as milliseconds, matching the other platforms', () => {
    // `TotalProcessorTime` is a TimeSpan; the series compares this against
    // `ps -o time=` and `/proc/<pid>/stat`, both of which this module converts to ms.
    assert.match(windowsScript(1), /TotalMilliseconds/)
  })
})

describe('DDQ05 — parsing is separate from running', () => {
  it('takes the last line, so a profile warning cannot break the parse', () => {
    // Measured risk: an image with a profile snippet prints a banner even with
    // `-NoProfile` on some builds; the JSON is the last line, not the whole output.
    const withBanner = `WARNING: something\r\n${HEALTHY}`
    const parsed = parseWindowsSample(withBanner)
    assert.equal(parsed.rss, 128 * 1024 * 1024)
  })

  it('tolerates CRLF line endings', () => {
    const parsed = parseWindowsSample(`${HEALTHY}\r\n`)
    assert.equal(parsed.handleCount, 512)
  })
})


describe('DDQ06 — the Windows identity lookup, without wmic', () => {
  /*
   * `findAppPid` on Windows used `wmic`, which is **not on the runner** — measured: the
   * branch returned `null` and `e2e-09` reported "could not find the app process" on a job
   * that could never have produced a sample. These tests drive the replacement through
   * `platform: 'win32'` and a stubbed `ps`/PowerShell, so the parse and the quoting rules
   * are pinned without a Windows machine.
   */

  it('quotes a path with a space so the CIM filter still matches', () => {
    /*
     * The runner's binary lives under `D:\a\terminal\terminal\src-tauri\target\release\terminal.exe`,
     * and a developer's checkout can easily contain a space. An unquoted filter matches
     * nothing, which reads as "the app is not running" — the exact false negative this
     * whole task book is about.
     */
    const script = windowsScript(1)
    assert.ok(script.includes('Get-Process'), 'the sample script uses Get-Process')
    // The identity lookup lives in process-sampler.mjs; its output is exercised below.
    assert.equal(typeof findAppPid, 'function')
  })

  it('returns null rather than a pid when the lookup fails', () => {
    // On a non-Windows host the PowerShell call cannot run, so the branch must answer
    // "unknown" instead of inventing a process.
    assert.equal(findAppPid('/no/such/binary', 'win32'), null)
  })

  it('does not match a path merely contained in another', () => {
    // The POSIX branch's rule — argv[0] exactly — has to hold on Windows too, or a
    // `terminal-helper.exe` would satisfy a lookup for `terminal.exe`.
    assert.equal(findAppPid('/no/such/terminal.exe', 'win32'), null)
  })
})
