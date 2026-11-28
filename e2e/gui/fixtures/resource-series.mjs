// DDQ03 — a resource run is a series with its round indices, and completeness is a
// property computed BEFORE any curve rule runs.
//
// ## Why this module exists, in one measured sentence
//
// `e2e-09` used to reduce each metric with `samples.map(...).filter(v => v !== null)`
// before handing it to `summariseSeries`. `resource-curve.mjs` refuses a series that
// contains a hole — it has a test named "refuses a series with a hole in it" — and the
// filter removed every hole before the rule could see one. The guard was not weakened,
// it was bypassed, and the bypass also destroyed the time index: 12 valid RSS samples out
// of 100 rounds became a 12-element array, and `minimumSamples` is exactly 12, so an
// almost-unmeasured run was summarised as a curve.
//
// ## The two questions this module keeps apart
//
// 1. **Was the run measured?** — coverage, gaps, ordering, early exit. Answered here,
//    from the samples as they arrived, and answered *before* any trend is computed.
// 2. **What does the trend say?** — `resource-curve.mjs`, unchanged, over a series that
//    is known to be complete.
//
// Mixing them is how a run with a 87% hole gets a `NO_LEAK_DETECTED`: the second question
// has a confident answer whenever it is asked, and nothing in it can notice that the data
// behind the answer is mostly absent.
//
// ## What is deliberately NOT here
//
// No thresholds for what counts as a leak, no platform knowledge, no process discovery.
// This is arithmetic over an array of samples, so it can be tested with synthetic runs —
// the same reason `resource-curve.mjs` is a pure function.

/** Metrics a caller may ask about. Anything else in a sample is ignored. */
export const KNOWN_METRICS = ['rssBytes', 'openFds', 'threads', 'cpuTimeMs', 'handles']

/**
 * The completeness a 100-round run has to meet to be called a curve.
 *
 * `minCoverage` 0.9 rather than 1.0: a single unreadable round out of 100 (the process
 * was between states, `ps` raced the sampler) does not invalidate the other 99, and
 * demanding perfection would push a spec toward re-running until it gets a clean one —
 * which is how a real intermittent problem gets hidden.
 *
 * `maxConsecutiveMissing` 2 rather than 1: one blank round in the middle is a sampling
 * hiccup, two in a row is the beginning of a gap the trend cannot cross.
 *
 * `minRounds` is the number the task names. A run shorter than this is not the formal
 * curve, whatever its coverage is.
 */
export const DEFAULT_COMPLETENESS = {
  minCoverage: 0.9,
  maxConsecutiveMissing: 2,
  minRounds: 100,
}

/**
 * Turn the sampler's output into a series that still knows where each value came from.
 *
 * `samples` is an array of `{ round, <metric>, unavailable? }` in arrival order. The
 * round number is carried into `rounds`; the values arrays are the **same length as
 * `samples`** with `null` where a metric was unavailable, so `values.rssBytes[8]` is
 * round 8's reading rather than the 9th reading that happened to exist.
 *
 * `expectedSamples` defaults to the number of samples actually collected. A caller that
 * knows how many rounds it *asked* for must pass it: a process that dies at round 60
 * produces 60 samples, and 60 of 60 would otherwise read as a complete run.
 *
 * ## The baseline is not a round
 *
 * A run takes one reading before the first round of work, so the process's starting point
 * is visible without comparing against a number from another run. That reading is passed
 * as `round: -1` and is kept in `baseline` rather than mixed into the per-round columns:
 * counting it as a round makes every artifact read "101 of 100 rounds sampled", which is
 * how the first version of this change shipped a one-off error into the evidence.
 */
export function buildSeries(samples, metrics, options = {}) {
  const all = Array.isArray(samples) ? samples : []
  /*
   * Rounds are `≥ 0`; the baseline is `-1`. Splitting them here keeps the columns aligned
   * with the rounds the caller asked for, and keeps the baseline available as the series'
   * own starting point instead of as a phantom round.
   */
  const list = all.filter(sample => sample.round >= 0)
  const baselineSample = all.find(sample => sample.round === -1) ?? null
  const asked = options.expectedSamples
  const expectedSamples =
    Number.isFinite(asked) && asked > 0 ? asked : list.length
  const optional = new Set(options.optionalMetrics ?? [])
  const baseline = baselineSample
    ? Object.fromEntries(metrics.map(metric => [metric, baselineSample[metric] ?? null]))
    : null

  const rounds = list.map(sample => sample.round)
  const values = {}
  const perMetricValidSamples = {}
  const missingRounds = {}
  const maximumConsecutiveMissing = {}
  const unavailableReasons = {}

  for (const metric of metrics) {
    /*
     * ## The absent rounds are missing samples too
     *
     * A process that exits at round 60 leaves 60 entries. If the column were built from
     * the array alone, rounds 60–99 would simply not exist and `missingRounds` would be
     * empty — an early exit would read as a complete run of 60. The column is therefore
     * laid out over the **expected** rounds: the samples that arrived, and `null` for
     * every round the run asked for and never got.
     *
     * Measured while writing this: the first version did exactly that wrong thing and the
     * "process dies at round 60" test failed with `0 !== 40` missing rounds.
     */
    const byRound = new Map()
    for (const sample of list) {
      byRound.set(sample.round, sample)
    }
    const column = []
    for (let round = 0; round < expectedSamples; round += 1) {
      const sample = byRound.get(round)
      column.push(
        sample && typeof sample[metric] === 'number' && Number.isFinite(sample[metric])
          ? sample[metric]
          : null,
      )
    }
    values[metric] = column

    const missing = []
    let gap = 0
    let longest = 0
    for (let index = 0; index < column.length; index += 1) {
      if (column[index] === null) {
        missing.push(index)
        gap += 1
        if (gap > longest) longest = gap
      } else {
        gap = 0
      }
    }
    perMetricValidSamples[metric] = column.length - missing.length
    missingRounds[metric] = missing
    maximumConsecutiveMissing[metric] = longest

    const reasons = {}
    for (const sample of list) {
      const value = sample[metric]
      if (typeof value === 'number' && Number.isFinite(value)) continue
      const reason =
        sample.unavailable && typeof sample.unavailable[metric] === 'string'
          ? sample.unavailable[metric]
          : 'no reason recorded'
      reasons[reason] = (reasons[reason] ?? 0) + 1
    }
    if (list.length < expectedSamples) {
      // Rounds the run never reached carry their own reason: the array has no entry to
      // name one, and "absent because the run stopped" is different from "the sampler
      // ran and ps said nothing".
      reasons['the run never reached this round'] = expectedSamples - list.length
    }
    unavailableReasons[metric] = reasons
  }

  const scope = {
    metrics: Object.fromEntries(
      metrics.map(metric => [metric, optional.has(metric) ? 'OPTIONAL' : 'REQUIRED']),
    ),
  }

  return {
    expectedSamples,
    observedSamples: list.length,
    // The rounds that actually produced a sample. For a run that finished this equals
    // `observedSamples`; keeping it separate means "60 observed of 100 expected" and
    // "60 observed of 60 expected" cannot be confused for each other.
    completedRounds: list.length,
    rounds,
    values,
    baseline,
    perMetricValidSamples,
    missingRounds,
    maximumConsecutiveMissing,
    unavailableReasons,
    scope,
  }
}

/**
 * What is wrong with this run's coverage, as a list of named problems.
 *
 * Each problem names the metric (or `'run'` for a whole-run problem) and carries a
 * `detail` a reader can act on. An empty array means every required metric covers enough
 * of the run, no gap is longer than allowed, the round numbers are strictly increasing,
 * and the run is long enough to be the formal curve.
 *
 * `optionalMetrics` relaxes the coverage and gap rules for a metric a platform cannot
 * report at all: declaring CPU out of scope is a statement about the platform, not a
 * sampling failure, and conflating the two would either hide a failure or block a
 * platform for a metric it was never asked to provide.
 */
export function completenessProblems(series, limits = DEFAULT_COMPLETENESS) {
  const problems = []
  const { minCoverage, maxConsecutiveMissing, minRounds } = {
    ...DEFAULT_COMPLETENESS,
    ...limits,
  }

  if (series.observedSamples === 0) {
    problems.push({
      metric: 'run',
      detail: 'no samples were collected, so there is no run to judge',
    })
    return problems
  }

  /*
   * Ordering first: every coverage number below assumes the array is a timeline. If two
   * rounds share a number, "sample 40 of 100" is not a position in time and nothing
   * downstream means what it says.
   */
  const outOfOrder = series.rounds.findIndex(
    (round, index) => index > 0 && !(round > series.rounds[index - 1]),
  )
  if (outOfOrder > -1) {
    problems.push({
      metric: 'run',
      detail:
        `round numbers are not strictly increasing at index ${outOfOrder} ` +
        `(${series.rounds[outOfOrder - 1]} then ${series.rounds[outOfOrder]})`,
    })
  }

  if (series.expectedSamples < minRounds) {
    problems.push({
      metric: 'run',
      detail:
        `this run asked for ${series.expectedSamples} rounds; the formal curve needs ${minRounds}`,
    })
  }

  if (series.observedSamples < series.expectedSamples) {
    problems.push({
      metric: 'run',
      detail:
        `only ${series.observedSamples} of ${series.expectedSamples} rounds produced a ` +
        'sample — the process stopped early or the sampler lost it',
    })
  }

  for (const [metric, requirement] of Object.entries(series.scope.metrics)) {
    const valid = series.perMetricValidSamples[metric] ?? 0
    const coverage = series.expectedSamples > 0 ? valid / series.expectedSamples : 0
    const gap = series.maximumConsecutiveMissing[metric] ?? 0

    if (requirement === 'OPTIONAL' && valid === 0) {
      // Declared out of scope for this platform. Not a defect; the scope field keeps it
      // from being mistaken for full coverage either.
      continue
    }

    if (coverage < minCoverage) {
      problems.push({
        metric,
        detail:
          `only ${valid} of ${series.expectedSamples} rounds have a ${metric} value ` +
          `(${(coverage * 100).toFixed(0)}%, need ${(minCoverage * 100).toFixed(0)}%)`,
      })
    }

    if (gap > maxConsecutiveMissing) {
      problems.push({
        metric,
        detail:
          `${gap} consecutive rounds have no ${metric} value; a curve drawn across them ` +
          'joins two samples that are not adjacent in time',
      })
    }
  }

  return problems
}
