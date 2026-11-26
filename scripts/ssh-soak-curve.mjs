/**
 * F17 — turning a series of RSS / descriptor samples into a statement.
 *
 * ## Why this is a separate, pure function
 *
 * The soak's own assertions are deterministic: after every round the product's pool and
 * registry return to zero, and that blocks. RSS and file descriptors are not like that.
 * They move with the allocator, with `sshd` teardown timing and with whatever else the
 * runner is doing, so **one reading is not evidence of anything** — including a large
 * one.
 *
 * What is evidence is the shape of the series across many rounds. A leak keeps going up;
 * noise goes up and down around a level. This module encodes that difference as a
 * decision with a stated rule, so the verdict is reproducible across runs instead of
 * being whatever the reader thought the chart looked like.
 *
 * ## The rule, and why these thresholds
 *
 * A series is called a leak only when **both** hold:
 *
 *   - the second half is materially above the first half (a sustained slope, not a spike);
 *   - the final value is materially above the peak of the first half (so a run that grew
 *     early and stayed flat is not called a leak).
 *
 * "Materially" is a percentage with an absolute floor. The percentage alone would call a
 * 2 KB drift across 100 rounds a leak; the absolute floor alone would ignore a 40 % rise
 * on a small process. Both are needed because RSS on a quiet runner genuinely drifts.
 *
 * Descriptors use a tighter rule: they are integral and a healthy process returns to
 * exactly its baseline, so any sustained excess is worth reporting.
 */

/** What a series of samples is allowed to be called. */
export const CURVE_VERDICTS = /** @type {const} */ ([
  'FLAT',
  'GROWING_WITHIN_NOISE',
  'LEAK_SUSPECTED',
  'INSUFFICIENT_DATA',
])

/**
 * The thresholds, named so a reader can disagree with them by name rather than by
 * reverse-engineering a magic number.
 */
export const CURVE_LIMITS = {
  /** Fewer samples than this cannot distinguish a slope from a warm-up. */
  minimumSamples: 8,
  /** A first-half/second-half difference below this fraction is noise. */
  rssGrowthFraction: 0.2,
  /** …and below this many bytes is noise regardless of the fraction. */
  rssGrowthFloorBytes: 8 * 1024 * 1024,
  /** Descriptors: any sustained excess over the first-half peak is reported. */
  fdSlack: 2,
  /**
   * The fraction of consecutive samples that must rise for a series to count as
   * *sustained* growth.
   *
   * This is what separates a leak from a warm-up. A process that allocates and then
   * settles goes up and down; a leak goes up, and on most consecutive rounds it goes up
   * again. Thresholds on magnitude alone cannot see that difference — measured while
   * writing this: a genuine 156 MiB climb on a 2 GiB baseline is a 7.6 % relative rise,
   * which a 20 % rule calls noise.
   */
  sustainedRiseFraction: 0.9,
  /** Below this many bytes a "sustained rise" is still too small to act on. */
  sustainedFloorBytes: 4 * 1024 * 1024,
}

/** Split a series in half; the first half is the reference. */
function halves(series) {
  const mid = Math.floor(series.length / 2)
  return [series.slice(0, mid), series.slice(mid)]
}

function peak(series) {
  return series.reduce((max, value) => (Number.isFinite(value) && value > max ? value : max), 0)
}

function median(series) {
  if (series.length === 0) return 0
  const sorted = [...series].filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Judge one metric's series.
 *
 * `samples` are the per-round values in round order, excluding the baseline.
 */
export function judgeSeries(samples, limits = CURVE_LIMITS) {
  const finite = samples.filter(Number.isFinite)
  if (finite.length < limits.minimumSamples) {
    return {
      verdict: 'INSUFFICIENT_DATA',
      samples: finite.length,
      reason: `need at least ${limits.minimumSamples} samples, got ${finite.length}`,
    }
  }

  const [firstHalf, secondHalf] = halves(finite)
  const firstMedian = median(firstHalf)
  const secondMedian = median(secondHalf)
  const firstPeak = peak(firstHalf)
  const last = finite[finite.length - 1]

  const growth = secondMedian - firstMedian
  const growthLimit = Math.max(
    limits.rssGrowthFloorBytes,
    firstMedian * limits.rssGrowthFraction,
  )

  /*
   * A series that ended below the first half's peak came back down. Whatever happened in
   * the middle, the process is not holding more than it held early on, so it is not a
   * leak — this is the warm-up-and-plateau shape a healthy run shows.
   */
  if (last <= firstPeak) {
    return {
      verdict: 'FLAT',
      firstMedian,
      secondMedian,
      last,
      reason: 'the final sample is at or below the first half peak, so nothing accumulated',
    }
  }

  /*
   * ## Sustained growth is checked before magnitude
   *
   * A large process hides a real leak from a percentage rule: 156 MiB on a 2 GiB
   * baseline is 7.6 %. But leak-shaped growth has a signature that magnitude rules miss
   * entirely — it rises on almost every consecutive sample. A warm-up rises and then
   * stops; noise rises and falls. Requiring both a sustained rise AND a real absolute
   * distance from the start keeps this from firing on a file that merely warms in
   * stages.
   */
  const rises = finite.slice(1).filter((value, index) => value > finite[index]).length
  const riseFraction = rises / (finite.length - 1)
  const sustainedRise = riseFraction >= limits.sustainedRiseFraction
  const totalRise = last - finite[0]
  if (sustainedRise && totalRise >= limits.sustainedFloorBytes) {
    return {
      verdict: 'LEAK_SUSPECTED',
      firstMedian,
      secondMedian,
      last,
      growth,
      growthLimit,
      riseFraction,
      reason:
        `the series rose on ${rises} of ${finite.length - 1} consecutive samples ` +
        `(${(riseFraction * 100).toFixed(0)} %) and ended ${totalRise} bytes above where ` +
        `it started — a warm-up plateaus, this did not`,
    }
  }

  if (growth <= growthLimit) {
    return {
      verdict: 'GROWING_WITHIN_NOISE',
      firstMedian,
      secondMedian,
      last,
      growth,
      growthLimit,
      reason: `second-half median is ${growth} above the first, under the ${growthLimit} noise limit`,
    }
  }

  return {
    verdict: 'LEAK_SUSPECTED',
      firstMedian,
    secondMedian,
    last,
    growth,
    growthLimit,
    reason:
      `second-half median (${secondMedian}) is ${growth} above the first (${firstMedian}), ` +
      `over the ${growthLimit} noise limit, and the final sample (${last}) stayed above ` +
      `the first-half peak (${firstPeak})`,
  }
}

/** Judge a descriptor series with the tighter integral rule. */
export function judgeDescriptors(samples, limits = CURVE_LIMITS) {
  const finite = samples.filter(Number.isFinite)
  if (finite.length < limits.minimumSamples) {
    return {
      verdict: 'INSUFFICIENT_DATA',
      samples: finite.length,
      reason: `need at least ${limits.minimumSamples} samples, got ${finite.length}`,
    }
  }
  const [firstHalf] = halves(finite)
  const firstPeak = peak(firstHalf)
  const last = finite[finite.length - 1]
  const excess = last - firstPeak
  if (excess > limits.fdSlack) {
    return {
      verdict: 'LEAK_SUSPECTED',
      firstPeak,
      last,
      excess,
      reason: `the run ended with ${excess} more descriptors open than its early peak (${firstPeak})`,
    }
  }
  return {
    verdict: 'FLAT',
    firstPeak,
    last,
    excess,
    reason: `the run ended within ${limits.fdSlack} descriptors of its early peak (${firstPeak})`,
  }
}

/** The two judgements plus the samples they came from, for the report file. */
export function summariseCurve({ rss = [], fds = [] } = {}) {
  const rssJudgement = judgeSeries(rss)
  const fdJudgement = judgeDescriptors(fds)
  /*
   * ## Leak first, then insufficient data, then clean
   *
   * The order is a priority, not a preference. A measured leak outranks a missing series:
   * if one metric climbed across 100 rounds while the other had no samples, the honest
   * headline is the climb. Reporting INSUFFICIENT_DATA there would bury the one fact the
   * soak produced.
   *
   * And INSUFFICIENT_DATA outranks NO_LEAK_DETECTED for the mirror reason: calling a run
   * clean when it had six samples is the quiet overclaim the harness's own NOT_RUN rule
   * exists to prevent.
   */
  const verdicts = [rssJudgement.verdict, fdJudgement.verdict]
  const verdict = verdicts.includes('LEAK_SUSPECTED')
    ? 'LEAK_SUSPECTED'
    : verdicts.includes('INSUFFICIENT_DATA')
      ? 'INSUFFICIENT_DATA'
      : 'NO_LEAK_DETECTED'
  return { verdict, rss: rssJudgement, fds: fdJudgement, samples: { rss: rss.length, fds: fds.length } }
}
