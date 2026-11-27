// RC18 — the curve rule must separate the three shapes the task names.
//
// Each series below is synthetic and shaped like one of them, so the rule can be tested
// without a 100-round run. The rule is the part that is easy to get wrong: a first-vs-last
// comparison calls a sawtooth a leak, and "the last sample is lower than the peak" calls a
// plateau healthy whether or not its floor is climbing.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  floorRise,
  floorsClimb,
  summariseSeries,
} from './resource-curve.mjs'

const LIMITS = {
  minimumSamples: 12,
  growthFraction: 0.2,
  growthFloor: 8 * 1024 * 1024,
  labels: { unit: 'B' },
}

const MiB = 1024 * 1024

/** A run that settles at a ceiling: rises for a while, then flat. */
const plateau = () => Array.from({ length: 48 }, (_, i) => (i < 12 ? (i + 1) * 2 * MiB : 24 * MiB))

/** A run that oscillates around a stable level. */
const sawtooth = () =>
  Array.from({ length: 48 }, (_, i) => 20 * MiB + (i % 4) * 3 * MiB)

/** Each trough higher than the last — the only shape that is evidence of a leak. */
const leak = () => Array.from({ length: 48 }, (_, i) => (20 + i * 2) * MiB + (i % 3) * MiB)

describe('RC18 — the curve rule names the shape', () => {
  it('calls a cache plateau healthy', () => {
    const result = summariseSeries(plateau(), LIMITS)
    assert.equal(result.verdict, 'NO_LEAK_DETECTED', result.reason)
  })

  it('does not call a sawtooth a leak', () => {
    /*
     * The case a first-vs-last comparison gets wrong: the last sample is often higher than
     * the first purely from where the oscillation landed.
     */
    const result = summariseSeries(sawtooth(), LIMITS)
    assert.equal(result.verdict, 'NO_LEAK_DETECTED', result.reason)
  })

  it('calls a climbing floor a leak', () => {
    const result = summariseSeries(leak(), LIMITS)
    assert.equal(result.verdict, 'LEAK_SUSPECTED', result.reason)
    assert.match(result.reason, /kept climbing/)
  })

  it('refuses to summarise too few samples', () => {
    /*
     * The PR-time regression produces 12 rounds; a full soak produces 100. Calling the
     * shorter one a curve would be a lie, so the threshold is the full run and anything
     * under it is INSUFFICIENT_DATA rather than a verdict.
     */
    const result = summariseSeries(Array.from({ length: 11 }, () => 20 * MiB), LIMITS)
    assert.equal(result.verdict, 'INSUFFICIENT_DATA')
    assert.match(result.reason, /11 sample\(s\); 12 are needed/)
  })

  it('accepts exactly the minimum, so the boundary is not off by one', () => {
    const result = summariseSeries(Array.from({ length: 12 }, () => 20 * MiB), LIMITS)
    assert.equal(result.verdict, 'NO_LEAK_DETECTED', result.reason)
  })

  it('refuses a series with a hole in it', () => {
    /*
     * A missing sample is not a zero. Filtering holes out would silently shorten the run
     * and report a curve that was never measured.
     */
    const withHole = [...plateau()]
    withHole[10] = null
    const result = summariseSeries(withHole, LIMITS)
    assert.equal(result.verdict, 'INSUFFICIENT_DATA')
    assert.match(result.reason, /not numbers/)
  })

  it('refuses a series that is not an array', () => {
    assert.equal(summariseSeries(null, LIMITS).verdict, 'INSUFFICIENT_DATA')
  })
})

describe('RC18 — floor comparisons', () => {
  it('measures the floor, not the mean', () => {
    /*
     * The reason floors are minima: a leak raises the troughs, while peaks are dominated by
     * whatever the previous round left unreclaimed. A mean-based rule would call a
     * sawtooth with an unchanged floor a leak.
     */
    const values = [...sawtooth()]
    assert.ok(Math.abs(floorRise(values)) < 0.2, `floor moved: ${floorRise(values)}`)
  })

  it('sees the floor climb only when it actually does', () => {
    assert.equal(floorsClimb(leak()), true)
    assert.equal(floorsClimb(plateau()), false)
  })

  it('returns null rather than guessing on a short series', () => {
    assert.equal(floorRise([1, 2, 3]), null)
    assert.equal(floorsClimb([1, 2, 3]), null)
  })

  it('refuses to divide by a zero floor', () => {
    // A descriptor count of zero is not a baseline; it is a failed read that slipped past
    // the null check, and a percentage against it would be meaningless.
    assert.equal(floorRise([0, 0, 0, 0, 0, 0, 0, 1]), null)
  })
})
