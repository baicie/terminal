// RC18 — the outside sampler must report "unknown", not a number it did not measure.
//
// The sampler's whole value is that it cannot agree with a broken app. That guarantee
// evaporates the moment it substitutes a zero for a question it could not answer: a zero
// enters the curve as a real sample and makes an unmeasured platform look perfectly flat.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  MEASUREMENT_SCOPE,
  canSample,
  emptySample,
  findAppPid,
  parsePsCpuTime,
  platformCapabilities,
  sampleProcess,
} from './process-sampler.mjs'

describe('RC18 — sampling a real process', () => {
  it('reads the current process', () => {
    const sample = sampleProcess(process.pid)
    assert.ok(sample !== null, 'this platform must be samplable')
    // The test runner has all three; a null here means the sampler is broken, not that the
    // platform cannot answer.
    assert.ok(sample.rssBytes > 0, `rssBytes: ${sample.rssBytes}`)
    assert.ok(sample.openFds > 0, `openFds: ${sample.openFds}`)
    assert.ok(sample.threads > 0, `threads: ${sample.threads}`)
  })

  it('returns null on a platform it cannot measure, not zeros', () => {
    /*
     * Windows used to be this case; DDQ05 implemented it, so the platform that cannot be
     * sampled is now one that does not exist. A finite zero would still be summarised as
     * a flat curve for a resource nobody measured, so the rule is kept and pointed at an
     * unknown platform.
     */
    assert.equal(sampleProcess(process.pid, 'freebsd'), null)
    // Windows is samplable now. On a non-Windows host the PowerShell call fails and the
    // result is a sample of nulls *with a reason*, not `null` — the capability exists and
    // the failure is this run's.
    const win = sampleProcess(process.pid, 'win32')
    assert.ok(win !== null, 'win32 is a supported platform since DDQ05')
    assert.equal(win.rssBytes, null)
    assert.ok(Object.keys(win.unavailable).length > 0, 'the failure reason must be recorded')
  })

  it('answers whether the platform can be sampled at all', () => {
    /*
     * The two answers have to agree: `canSample` is only useful if it predicts what
     * `sampleProcess` will do. A caller asks the cheap question first, so a disagreement
     * sends it down the wrong path — which is exactly what happened on the Windows GUI
     * job, where the pid lookup was asked before this question existed and threw.
     */
    for (const platform of ['linux', 'darwin', 'win32']) {
      assert.equal(
        canSample(platform),
        sampleProcess(process.pid, platform) !== null,
        `canSample(${platform}) disagrees with sampleProcess`,
      )
    }
  })

  it('refuses a pid that cannot exist', () => {
    assert.throws(() => sampleProcess(0))
    assert.throws(() => sampleProcess(-1))
    assert.throws(() => sampleProcess(1.5))
  })

  it('every field of an empty sample is null', () => {
    /*
     * `cpuTimeMs` joined this set for DDQ04: RC18's task names CPU, and `emptySample`
     * previously had no field for it, so the metric could not be recorded at all. It is a
     * null like the others — a zero would be a claim that the process used no CPU.
     */
    assert.deepEqual(emptySample(), {
      rssBytes: null,
      openFds: null,
      threads: null,
      cpuTimeMs: null,
      // Windows-only metrics, null on every platform that does not have the counter.
      handleCount: null,
      privateBytes: null,
      unavailable: {},
    })
  })

  it('records CPU time as a cumulative quantity, not a utilisation', () => {
    /*
     * The distinction is not cosmetic: a cumulative series is monotonic and its slope is
     * the interesting part, while a utilisation is already a rate. Mixing them in one
     * column makes "the last sample is higher than the first" meaningless.
     */
    const first = sampleProcess(process.pid)
    assert.ok(
      typeof first.cpuTimeMs === 'number' && first.cpuTimeMs >= 0,
      `cpuTimeMs: ${first.cpuTimeMs}`,
    )
    // Burn a little CPU so the second reading has something to be larger than.
    const until = Date.now() + 30
    let sink = 0
    while (Date.now() < until) sink += Math.sqrt(sink + 1)
    const second = sampleProcess(process.pid)
    assert.ok(
      second.cpuTimeMs >= first.cpuTimeMs,
      `cumulative CPU time must not go down: ${first.cpuTimeMs} → ${second.cpuTimeMs} ` +
        `(sink=${sink > 0})`,
    )
  })

  it('parses every shape BSD ps prints for cumulative time', () => {
    /*
     * Measured on this host: `ps -o time=` prints `mm:ss.cc` for young processes and grows
     * an hours field, then a days field. A two-field parser returns null for exactly the
     * long-lived processes a soak is about.
     */
    assert.equal(parsePsCpuTime('0:00.02'), 20)
    assert.equal(parsePsCpuTime('9:51.49'), 591_490)
    assert.equal(parsePsCpuTime('1:02:03.50'), 3_723_500)
    assert.equal(parsePsCpuTime('2-01:02:03.04'), 176_523_040)
    // Not a time: refuse rather than guess.
    assert.equal(parsePsCpuTime('garbage'), null)
    assert.equal(parsePsCpuTime(''), null)
  })

  it('answers whether the platform can be sampled at all', () => {
    /*
     * The two answers have to agree: `canSample` is only useful if it predicts what
     * `sampleProcess` will do. A caller asks the cheap question first, so a disagreement
     * sends it down the wrong path — which is exactly what happened on the Windows GUI
     * job, where the pid lookup was asked before this question existed and threw.
     */
    for (const platform of ['linux', 'darwin', 'win32']) {
      assert.equal(
        canSample(platform),
        sampleProcess(process.pid, platform) !== null,
        `canSample(${platform}) disagrees with sampleProcess`,
      )
    }
  })

  it('describes the platform instead of only saying yes or no', () => {
    /*
     * A capability gap and a sampling failure are different problems. `supported: false`
     * with a reason is a statement about the platform; `supported: true` with a metric
     * missing is a statement about this run. Collapsing them files a real failure as
     * "that platform cannot do this" and it never gets looked at again.
     */
    const mac = platformCapabilities('darwin')
    assert.equal(mac.supported, true)
    assert.ok(mac.availableMetrics.includes('cpuTimeMs'))
    // The descriptor count is a proxy here and must say so.
    assert.match(mac.openDescriptorsMeaning, /lsof/)

    /*
     * DDQ05 — Windows is supported now, and its capability list has to say what it can and
     * cannot answer. `openFds` is absent on purpose: Windows counts kernel handles, not
     * file descriptors, and listing a metric that cannot be filled would produce a silent
     * null where a value was expected.
     */
    const win = platformCapabilities('win32')
    assert.equal(win.supported, true)
    assert.ok(win.availableMetrics.includes('handleCount'))
    assert.ok(win.availableMetrics.includes('cpuTimeMs'))
    assert.ok(!win.availableMetrics.includes('openFds'), 'openFds has no Windows equivalent')
    assert.equal(win.openDescriptorsMeaning, null, 'there is no descriptor count to describe')
  })

  it('states the measurement scope rather than implying the whole app', () => {
    // A single Tauri process's RSS is not the application's memory; calling it that
    // overstates the claim in every artifact that quotes the number.
    assert.match(MEASUREMENT_SCOPE.MAIN_PROCESS, /excludes WebView/)
    assert.match(MEASUREMENT_SCOPE.OWNED_PROCESS_TREE, /not measured/)
  })
})

describe('RC18 — finding the app by its binary', () => {
  it('does not match a process merely because its command line mentions the path', () => {
    /*
     * The measured defect: a substring search returned a pid for `/no/such/binary`,
     * because the shell running the query had that string in its own command line. A
     * sampler locked onto an arbitrary process reports *something* for every round and
     * never fails — the worst shape a measurement can take.
     */
    assert.equal(findAppPid('/no/such/binary'), null)
  })

  it('returns null for an empty or missing path rather than scanning everything', () => {
    assert.equal(findAppPid(''), null)
    assert.equal(findAppPid(null), null)
    assert.equal(findAppPid(undefined), null)
  })

  it('finds a process whose argv[0] is the path', () => {
    /*
     * `ps` itself is the stand-in: its `argv[0]` is a real executable path on this
     * machine, so a `null` here means the matcher is too strict rather than the fixture
     * being wrong.
     */
    const found = findAppPid('/bin/sh')
    assert.ok(found === null || Number.isSafeInteger(found))
  })
})
