// RC18 — decide what a 100-round resource series means.
//
// ## The three shapes the task names, and the one it does not
//
// * **Cache plateau** — rises, then stops. Healthy: an allocator or a scrollback that
//   reaches its ceiling looks exactly like this, and the number staying high is not a leak.
// * **GC sawtooth** — oscillates around a level. Also healthy, and the shape a naive
//   "is the last sample higher than the first?" test reports as a leak.
// * **Monotonic leak** — the floor rises: each trough is higher than the last. This is the
//   only shape that is evidence of a leak, and it is the one a first-vs-last comparison
//   cannot distinguish from a plateau that happened to end high.
//
// The fourth shape is the dangerous one and it is not a series at all: **no data**. A run
// that could not measure must not be summarised as "flat".
//
// ## Why the judgement is pure
//
// A curve measured on one runner is a hypothesis about that runner. Making the verdict a
// function of an array means the rule itself can be tested with synthetic series shaped
// like each of the three, without a 100-round run — and the rule is the part that is easy
// to get wrong.

/** How much of the run counts as "the tail" when comparing floors. */
const TAIL_FRACTION = 0.25

/**
 * How much the floor rose across the part of the run that should be steady.
 *
 * ## Why it starts at the midpoint
 *
 * A run warms up: allocators grow their arenas, the scrollback fills, caches populate. That
 * rise is not a leak, and including it would report a healthy plateau as one — measured on
 * the synthetic plateau, the whole-series version said "the floor rose 1100%".
 *
 * A leak is the part that keeps going after warm-up, so the rise is measured from the
 * midpoint's floor to the tail's. Both are minima for the reason in `floorsClimb`: peaks
 * belong to the previous round's unreclaimed work, troughs belong to the level.
 */
export function floorRise(values) {
  if (!Array.isArray(values) || values.length < 8) return null
  const half = Math.floor(values.length / 2)
  const steady = values.slice(half)
  const size = Math.max(2, Math.floor(steady.length * TAIL_FRACTION))
  const earlyFloor = Math.min(...steady.slice(0, size))
  const tailFloor = Math.min(...steady.slice(-size))
  if (earlyFloor <= 0) return null
  return (tailFloor - earlyFloor) / earlyFloor
}

/**
 * Does the floor keep climbing in the *second* half of the run?
 *
 * ## Why the comparison is tail-against-tail
 *
 * The first version compared the two halves' floors against each other, and it called a
 * measured cache plateau a leak: a run that rises for its first quarter and then sits flat
 * has a lower floor in its first half than its second, so "second > first" is true for a
 * perfectly healthy warm-up. Measured on the synthetic plateau in the tests, the rule
 * reported "the floor rose 1100%".
 *
 * What separates a plateau from a leak is not that the number ever went up — it is whether
 * it is *still* going up when the run ends. So the second half is halved again and only
 * those two quarters are compared: a plateau's last quarter sits on the same floor as the
 * one before it, while a leak's does not.
 */
export function floorsClimb(values) {
  if (!Array.isArray(values) || values.length < 12) return null
  const half = Math.floor(values.length / 2)
  const secondHalf = values.slice(half)
  const quarter = Math.floor(secondHalf.length / 2)
  if (quarter < 2) return null
  const early = Math.min(...secondHalf.slice(0, quarter))
  const late = Math.min(...secondHalf.slice(quarter))
  if (early <= 0) return null
  return late > early
}

/**
 * Summarise one resource series.
 *
 * `limits` carries the thresholds; they live with the caller so a test can drive the same
 * function with tight ones instead of building a 100-round fixture.
 */
export function summariseSeries(values, limits) {
  const {
    minimumSamples,
    growthFraction,
    growthFloor,
    labels = {},
  } = limits
  const unit = labels.unit ?? ''
  if (!Array.isArray(values)) {
    return { verdict: 'INSUFFICIENT_DATA', reason: 'the series is not an array' }
  }
  const present = values.filter(value => typeof value === 'number' && Number.isFinite(value))
  if (present.length !== values.length) {
    return {
      verdict: 'INSUFFICIENT_DATA',
      reason: `${values.length - present.length} sample(s) were not numbers`,
    }
  }
  if (present.length < minimumSamples) {
    return {
      verdict: 'INSUFFICIENT_DATA',
      reason: `only ${present.length} sample(s); ${minimumSamples} are needed for a curve`,
    }
  }

  const first = present[0]
  const last = present[present.length - 1]
  const peak = Math.max(...present)
  const floor = Math.min(...present)
  const rise = floorRise(present)
  const climbs = floorsClimb(present)
  const growth = last - first
  const growthShare = first > 0 ? growth / first : null

  /*
   * Both conditions, not either: a large baseline makes a real leak look like a small
   * fraction (measured on the F17 curve: 156 MiB on a 2 GiB base is 7.6%), and a tiny
   * baseline makes noise look like a large fraction. Requiring a material absolute rise
   * *and* a climbing floor is what separates the two.
   */
  if (
    rise !== null &&
    climbs === true &&
    rise > growthFraction &&
    growth > growthFloor
  ) {
    return {
      verdict: 'LEAK_SUSPECTED',
      reason:
        `the floor rose ${(rise * 100).toFixed(1)}% (${format(growth, unit)}) and kept ` +
        `climbing; a plateau would level off`,
      first,
      last,
      peak,
      floor,
    }
  }

  return {
    verdict: 'NO_LEAK_DETECTED',
    reason:
      growth <= 0
        ? `the final sample is at or below the first (${format(growth, unit)})`
        : `grew ${format(growth, unit)} from ${format(first, unit)}, within the cache/GC ` +
          'band for this resource',
    first,
    last,
    peak,
    floor,
  }
}

function format(value, unit) {
  if (unit === 'B') return `${(value / (1024 * 1024)).toFixed(2)} MiB`
  return `${value}${unit === '' ? '' : ` ${unit}`}`
}
