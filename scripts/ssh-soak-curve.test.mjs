/**
 * F17 — the soak's curve judgement, exercised on series whose answer is known.
 *
 * ## Why these cases and not "some samples"
 *
 * A curve judge is easy to write so that it always says FLAT: with enough tolerance
 * every series is noise. Each test below therefore pins one *shape* and asserts the
 * verdict that shape must get — a real leak, a warm-up that plateaus, noise around a
 * level, and too little data to say anything. The leak case is the one that matters:
 * if it ever returns FLAT, the soak can never fail.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CURVE_LIMITS,
  judgeDescriptors,
  judgeSeries,
  summariseCurve,
} from './ssh-soak-curve.mjs'

const MiB = 1024 * 1024

/** A realistic warm-up: rises for a few rounds, then holds. */
function warmUpThenFlat() {
  return [
    80,
    120,
    150,
    165,
    168,
    170,
    169,
    171,
    170,
    172,
    171,
    170,
    171,
    170,
  ].map(value => value * MiB)
}

/** The leak signature: monotone, each round keeps a little more. */
function steadyLeak() {
  return Array.from({ length: 100 }, (_, index) => (80 + index * 2) * MiB)
}

describe('judging an RSS series', () => {
  it('calls a steady climb a suspected leak', () => {
    const result = judgeSeries(steadyLeak())
    assert.equal(result.verdict, 'LEAK_SUSPECTED', result.reason)
    assert.ok(result.growth > result.growthLimit)
  })

  it('does not call a warm-up that plateaus a leak', () => {
    const result = judgeSeries(warmUpThenFlat())
    // It ends at or below the first half's peak, which is the plateau signature.
    assert.equal(result.verdict, 'FLAT', result.reason)
  })

  it('does not call noise around a level a leak', () => {
    const noisy = Array.from({ length: 40 }, (_, index) =>
      (170 + (index % 5) * 2 - 4) * MiB,
    )
    assert.notEqual(judgeSeries(noisy).verdict, 'LEAK_SUSPECTED')
  })

  it('says it cannot tell when there are too few samples', () => {
    const result = judgeSeries([80, 90, 100].map(value => value * MiB))
    assert.equal(result.verdict, 'INSUFFICIENT_DATA')
    assert.match(result.reason, new RegExp(String(CURVE_LIMITS.minimumSamples)))
  })

  /*
   * The floor exists so a tiny process's 40 % rise is not a leak. Without it this
   * series — under a megabyte of movement — would be reported every time.
   */
  it('ignores growth below the absolute floor', () => {
    const tiny = Array.from({ length: 40 }, (_, index) => (2 * MiB) + index * 1024)
    assert.notEqual(judgeSeries(tiny).verdict, 'LEAK_SUSPECTED')
  })

  /*
   * And the fraction exists so a large process's real leak is not excused by the floor:
   * 100 MiB of growth on a 2 GiB baseline is suspicious even though it is under 20 %.
   */
  it('still sees a large absolute leak on a large baseline', () => {
    const large = Array.from({ length: 40 }, (_, index) => (2048 + index * 4) * MiB)
    assert.equal(judgeSeries(large).verdict, 'LEAK_SUSPECTED')
  })
})

describe('judging a descriptor series', () => {
  it('reports descriptors that never come back', () => {
    const leaking = Array.from({ length: 60 }, (_, index) => 12 + index)
    const result = judgeDescriptors(leaking)
    assert.equal(result.verdict, 'LEAK_SUSPECTED')
    assert.ok(result.excess > CURVE_LIMITS.fdSlack)
  })

  it('accepts a count that returns to its baseline', () => {
    const healthy = Array.from({ length: 60 }, (_, index) => 12 + (index % 3))
    assert.equal(judgeDescriptors(healthy).verdict, 'FLAT')
  })

  it('tolerates the documented slack', () => {
    const atSlack = Array.from({ length: 60 }, (_, index) => 12 + (index % 2))
    assert.equal(judgeDescriptors(atSlack).verdict, 'FLAT')
  })
})

describe('the combined verdict', () => {
  it('is NO_LEAK_DETECTED only when both metrics are judged and clean', () => {
    const summary = summariseCurve({
      rss: warmUpThenFlat(),
      fds: Array.from({ length: 60 }, () => 14),
    })
    assert.equal(summary.verdict, 'NO_LEAK_DETECTED')
  })

  it('is LEAK_SUSPECTED when either metric leaks', () => {
    const summary = summariseCurve({
      rss: warmUpThenFlat(),
      fds: Array.from({ length: 60 }, (_, index) => 12 + index),
    })
    assert.equal(summary.verdict, 'LEAK_SUSPECTED')
  })

  /*
   * A run with samples for one metric only must not be reported as clean: the missing
   * series is exactly the one that would have shown the leak.
   */
  it('is INSUFFICIENT_DATA when a metric has no samples', () => {
    // RSS clean, descriptors unmeasured: nothing leaked, but nothing was said about
    // descriptors either, so "clean" would be an overclaim.
    const summary = summariseCurve({ rss: warmUpThenFlat(), fds: [] })
    assert.equal(summary.verdict, 'INSUFFICIENT_DATA')
  })

  /*
   * The mirror case, and the reason the priority order is what it is: a measured leak
   * outranks a missing series. Reporting "not enough data" while one metric climbed
   * across every round would bury the only fact the soak produced.
   */
  it('reports the leak even when the other metric has no samples', () => {
    const summary = summariseCurve({ rss: steadyLeak(), fds: [] })
    assert.equal(summary.verdict, 'LEAK_SUSPECTED')
  })
})
