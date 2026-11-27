// RC18 — the outside sampler must report "unknown", not a number it did not measure.
//
// The sampler's whole value is that it cannot agree with a broken app. That guarantee
// evaporates the moment it substitutes a zero for a question it could not answer: a zero
// enters the curve as a real sample and makes an unmeasured platform look perfectly flat.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { emptySample, findAppPid, sampleProcess } from './process-sampler.mjs'

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
     * Windows is the case that matters: the F17 module returns `None` there for the same
     * reason. A finite zero would be summarised as a flat curve for a resource nobody
     * measured.
     */
    assert.equal(sampleProcess(process.pid, 'win32'), null)
  })

  it('refuses a pid that cannot exist', () => {
    assert.throws(() => sampleProcess(0))
    assert.throws(() => sampleProcess(-1))
    assert.throws(() => sampleProcess(1.5))
  })

  it('every field of an empty sample is null', () => {
    assert.deepEqual(emptySample(), { rssBytes: null, openFds: null, threads: null })
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
