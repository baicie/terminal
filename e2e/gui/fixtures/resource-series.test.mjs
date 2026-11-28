// DDQ03 — a resource run is only a curve if the rounds are actually there.
//
// ## The defect this pins, measured on run 45937332982
//
// `e2e-09` collects one sample per round and then, before judging, does:
//
//     const rss = samples.map(s => s.rssBytes).filter(v => v !== null)
//     const fds = samples.map(s => s.openFds).filter(v => v !== null)
//
// `resource-curve.mjs` deliberately **refuses** a series containing a hole — it has its
// own test for exactly that ("refuses a series with a hole in it"). The spec removes the
// holes first, so the rule never sees one. The guard is not weakened; it is bypassed.
//
// The consequence is worse than a lenient threshold. Filtering nulls also **destroys the
// time index**: a 100-round run whose RSS was readable in only 12 rounds becomes a
// 12-element array, and 12 is exactly `minimumSamples`, so it is summarised as a curve —
// of a run that was not measured. Two curves plotted from such an artifact look like
// consecutive rounds while the samples behind them are 8 rounds apart.
//
// So the unit of judgement has to be the **series with its round indices intact**, and
// completeness has to be a property computed before any curve rule runs.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildSeries,
  completenessProblems,
  DEFAULT_COMPLETENESS,
} from './resource-series.mjs'

const MiB = 1024 * 1024

/** A healthy 100-round run with every metric present on every round. */
function completeRun(rounds = 100) {
  const samples = []
  for (let round = 0; round < rounds; round += 1) {
    samples.push({
      round,
      rssBytes: 200 * MiB + round * 1024,
      openFds: 70,
      threads: 40,
      cpuTimeMs: 1000 + round * 10,
      unavailable: {},
    })
  }
  return samples
}

describe('DDQ03 — the series keeps the round each sample came from', () => {
  it('reports exactly one valid sample per metric for a complete run', () => {
    const series = buildSeries(completeRun(100), ['rssBytes', 'openFds', 'threads'])
    assert.equal(series.expectedSamples, 100)
    assert.equal(series.observedSamples, 100)
    assert.equal(series.completedRounds, 100)
    assert.equal(series.perMetricValidSamples.rssBytes, 100)
    assert.equal(series.perMetricValidSamples.openFds, 100)
    assert.deepEqual(series.missingRounds.rssBytes, [])
    assert.equal(series.maximumConsecutiveMissing.rssBytes, 0)
  })

  it('does not count the pre-round baseline as one of the rounds', () => {
    /*
     * Measured on a local 15-round run: the spec pushed the baseline as `round: 0` and
     * then rounds 1..15, so the artifact read `16 of 15 rounds sampled` — an off-by-one in
     * every single run, and one that made "expected vs observed" a number nobody could
     * trust. The baseline is the process *before* any work, so it is `round: -1` and it
     * lives in `baseline`, not in the columns.
     */
    const samples = [{ round: -1, rssBytes: 100, openFds: 5, threads: 3 }, ...completeRun(15)]
    const series = buildSeries(samples, ['rssBytes', 'openFds'], { expectedSamples: 15 })
    assert.equal(series.observedSamples, 15, 'the baseline must not be counted as a round')
    assert.equal(series.rounds.length, 15)
    assert.deepEqual(series.rounds, Array.from({ length: 15 }, (_, index) => index))
    assert.deepEqual(series.baseline, { rssBytes: 100, openFds: 5 })
  })

  it('keeps a hole as a hole instead of shortening the series', () => {
    /*
     * The measured failure shape: 100 rounds, RSS readable in 12 of them. The current
     * code produces a 12-element array and calls it a curve. The series must instead
     * report 12 of 100 with 88 missing rounds preserved in order.
     */
    const samples = completeRun(100)
    for (let round = 0; round < 100; round += 1) {
      if (round % 8 !== 0) samples[round].rssBytes = null
      samples[round].unavailable = samples[round].rssBytes === null ? { rssBytes: 'ps returned no value' } : {}
    }
    const series = buildSeries(samples, ['rssBytes', 'openFds'])
    assert.equal(series.perMetricValidSamples.rssBytes, 13, 'rounds 0,8,…,96 are 13 samples')
    assert.equal(series.expectedSamples, 100)
    // The values array must keep the round position, not the compacted order.
    assert.equal(series.values.rssBytes.length, 100)
    assert.equal(series.values.rssBytes[1], null)
    assert.equal(series.values.rssBytes[8], samples[8].rssBytes)
  })

  it('has a maximum consecutive gap, not just a total', () => {
    /*
     * Ten scattered misses and ten consecutive misses have the same count and are not the
     * same measurement. A curve drawn across a 10-round gap joins two samples ten rounds
     * apart and calls the slope a trend.
     */
    const scattered = completeRun(100)
    for (const round of [5, 15, 25, 35, 45, 55, 65, 75, 85, 95]) scattered[round].rssBytes = null
    const consecutive = completeRun(100)
    for (let round = 40; round < 50; round += 1) consecutive[round].rssBytes = null

    const a = buildSeries(scattered, ['rssBytes'])
    const b = buildSeries(consecutive, ['rssBytes'])
    assert.equal(a.perMetricValidSamples.rssBytes, b.perMetricValidSamples.rssBytes)
    assert.equal(a.maximumConsecutiveMissing.rssBytes, 1)
    assert.equal(b.maximumConsecutiveMissing.rssBytes, 10)
  })

  it('records why a metric is missing rather than only that it is', () => {
    const samples = completeRun(10)
    samples[3].rssBytes = null
    samples[3].unavailable = { rssBytes: 'lsof exited 1' }
    const series = buildSeries(samples, ['rssBytes'])
    assert.deepEqual(series.unavailableReasons.rssBytes, { 'lsof exited 1': 1 })
  })

  it('does not lose the trailing rounds when the process dies', () => {
    /*
     * A process that exits at round 60 leaves 60 samples. `observedSamples` alone cannot
     * tell that apart from a run configured for 60 rounds, which is why the expected
     * count is carried separately and comes from the spec, not from the array length.
     */
    const samples = completeRun(60)
    const series = buildSeries(samples, ['rssBytes'], { expectedSamples: 100 })
    assert.equal(series.observedSamples, 60)
    assert.equal(series.expectedSamples, 100)
    assert.equal(series.completedRounds, 60)
    assert.deepEqual(series.missingRounds.rssBytes.length, 40)
  })
})

describe('DDQ03 — completeness is judged before any curve rule', () => {
  it('refuses a run where one metric covers only part of it', () => {
    const samples = completeRun(100)
    for (let round = 0; round < 100; round += 1) {
      if (round % 8 !== 0) samples[round].rssBytes = null
    }
    const series = buildSeries(samples, ['rssBytes', 'openFds'])
    const problems = completenessProblems(series, DEFAULT_COMPLETENESS)
    assert.ok(
      problems.some(p => p.metric === 'rssBytes' && /only 13 of 100/.test(p.detail)),
      `expected an RSS coverage problem, got ${JSON.stringify(problems)}`,
    )
  })

  it('refuses a run that stopped early', () => {
    // The process died at round 60 of 100. A curve over the first 60 rounds is not the
    // 100-round curve the task asks for, and "observed 60" must not silently mean "ran 60".
    const series = buildSeries(completeRun(60), ['rssBytes'], { expectedSamples: 100 })
    const problems = completenessProblems(series, DEFAULT_COMPLETENESS)
    assert.ok(
      problems.some(p => p.metric === 'run' && /60 of 100 rounds/.test(p.detail)),
      `expected an incomplete-run problem, got ${JSON.stringify(problems)}`,
    )
  })

  it('refuses a long gap even when total coverage passes', () => {
    /*
     * 95 of 100 samples while rounds 40–44 are missing: coverage 95% passes a 5% budget,
     * but a five-round hole in the middle is not a continuous curve. Both rules exist
     * because each one alone has a shape it cannot see.
     */
    const samples = completeRun(100)
    for (let round = 40; round < 45; round += 1) samples[round].rssBytes = null
    const series = buildSeries(samples, ['rssBytes'])
    const problems = completenessProblems(series, { ...DEFAULT_COMPLETENESS, maxConsecutiveMissing: 2 })
    assert.ok(
      problems.some(p => p.metric === 'rssBytes' && /5 consecutive/.test(p.detail)),
      `expected a gap problem, got ${JSON.stringify(problems)}`,
    )
  })

  it('accepts a complete run without inventing problems', () => {
    const series = buildSeries(completeRun(100), ['rssBytes', 'openFds', 'threads'])
    assert.deepEqual(completenessProblems(series, DEFAULT_COMPLETENESS), [])
  })

  it('treats a metric that was never available as its own problem', () => {
    // A platform that cannot report CPU is a scope limit to declare, not a curve with
    // a 100% gap that looks like a total sampling failure.
    const samples = completeRun(100)
    for (const sample of samples) sample.cpuTimeMs = null
    const series = buildSeries(samples, ['rssBytes', 'cpuTimeMs'], {
      optionalMetrics: ['cpuTimeMs'],
    })
    const problems = completenessProblems(series, DEFAULT_COMPLETENESS)
    assert.deepEqual(problems, [], 'an optional metric that is never present is not a defect')
    assert.equal(series.scope.metrics.rssBytes, 'REQUIRED')
    assert.equal(series.scope.metrics.cpuTimeMs, 'OPTIONAL')
  })

  it('refuses a series whose round numbers repeat', () => {
    /*
     * The sampler could lock onto a second process, or a retry could re-record a round.
     * Either way the index is no longer a timeline, and every x-axis claim built on it
     * is false.
     */
    const samples = completeRun(20)
    samples[7].round = 6
    const series = buildSeries(samples, ['rssBytes'])
    const problems = completenessProblems(series, DEFAULT_COMPLETENESS)
    assert.ok(
      problems.some(p => p.metric === 'run' && /not strictly increasing/.test(p.detail)),
      `expected an ordering problem, got ${JSON.stringify(problems)}`,
    )
  })
})
